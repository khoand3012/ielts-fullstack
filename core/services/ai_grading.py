"""Grading one Writing session with the AI (spec §4, §7).

The `ai_assessments` row is the job record. A run re-reads it and does nothing unless it is
`processing`; it never holds a DB connection across the model call (read in one short
session, call the model, write each attempt and the outcome in their own); and a cancelled
run leaves the row `processing` for the next startup to pick up.
"""

import asyncio
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import select, type_coerce, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.ai.client import AIClientError, OpenRouterClient
from core.ai.injection import (
    Signal,
    clean_essay,
    implausible_band_signals,
    input_signals,
    word_count,
)
from core.ai.messages import TaskInput, build_request
from core.ai.output import (
    TASK_CRITERIA,
    ModelOutput,
    ModelTask,
    OutputError,
    check_quotes,
    parse_output,
)
from core.ai.prompts import PROMPT_VERSION
from core.models import (
    AIAssessment,
    Answer,
    AssessmentStatus,
    SessionMode,
    SignalSource,
    Skill,
    TestSession,
    TestVersion,
)
from core.schemas.content import WritingContent
from core.schemas.session import WritingComment, WritingCriterion, WritingResult, WritingTask
from core.services import catalog, storage
from core.services.bands import task_band, writing_overall
from core.services.content import RASTER_IMAGE_EXTENSIONS
from core.settings import get_settings

log = structlog.get_logger()

_ZEROS = (Decimal(0),) * 4


@dataclass(frozen=True)
class WritingBands:
    task1: Decimal | None
    task2: Decimal | None
    overall: Decimal | None


def writing_bands(
    mode: SessionMode, criteria: Mapping[int, Sequence[Decimal] | None]
) -> WritingBands:
    """Task and overall bands; `None` criteria mean a blank task. In an exam a blank task
    scores 0 and the overall is always given; in practice it isn't graded, and the overall
    needs both tasks."""
    filled = {
        n: (list(_ZEROS) if c is None and mode == SessionMode.EXAM else c)
        for n, c in ((n, criteria.get(n)) for n in (1, 2))
    }
    t1, t2 = filled[1], filled[2]
    return WritingBands(
        task1=task_band(t1) if t1 is not None else None,
        task2=task_band(t2) if t2 is not None else None,
        overall=writing_overall(t1, t2) if t1 is not None and t2 is not None else None,
    )


@dataclass
class GradingRunner:
    """What a grading run needs from outside: the DB, the model and the chart images."""

    factory: async_sessionmaker[AsyncSession]
    client: OpenRouterClient
    read_image: storage.ImageReader = storage.read_object
    semaphore: asyncio.Semaphore = field(init=False)

    def __post_init__(self) -> None:
        self.semaphore = asyncio.Semaphore(get_settings().ai_max_concurrency)


@dataclass(frozen=True)
class _Loaded:
    mode: SessionMode
    tasks: list[TaskInput]
    # every task in the test, graded or blank, with its word count
    words: dict[int, int]
    images: dict[int, str]


def _now() -> datetime:
    return datetime.now(UTC)


async def _load(db: AsyncSession, session_id: uuid.UUID) -> tuple[_Loaded, list[Signal]] | None:
    status = await db.scalar(
        select(AIAssessment.status).where(AIAssessment.test_session_id == session_id)
    )
    if status != AssessmentStatus.PROCESSING:
        return None
    ts = await db.get(TestSession, session_id)
    assert ts is not None
    version = await db.get(TestVersion, ts.test_version_id)
    assert version is not None
    content = catalog.load_content(Skill.WRITING, version)
    assert isinstance(content, WritingContent)
    notes = catalog.load_staff_content(version).examiner_notes
    answers = {
        a.question_number: a.value
        for a in await db.scalars(select(Answer).where(Answer.test_session_id == session_id))
    }
    tasks: list[TaskInput] = []
    words: dict[int, int] = {}
    images: dict[int, str] = {}
    signals: list[Signal] = []
    for task in sorted(content.tasks, key=lambda t: t.number):
        value = answers.get(task.number)
        if not isinstance(value, str) or not value.strip():
            words[task.number] = 0
            continue
        essay = clean_essay(value)
        words[task.number] = word_count(essay.text)
        signals += input_signals(task.number, essay)
        if task.image:
            images[task.number] = task.image
        tasks.append(
            TaskInput(
                number=task.number,
                prompt=task.prompt,
                min_words=task.min_words,
                essay=essay,
                words=words[task.number],
                note=notes.get(task.number),
                image=None,
            )
        )
    return _Loaded(SessionMode(ts.mode), tasks, words, images), signals


async def _with_images(
    runner: GradingRunner, session_id: uuid.UUID, loaded: _Loaded
) -> list[TaskInput]:
    tasks = []
    for task in loaded.tasks:
        key = loaded.images.get(task.number)
        if key is not None and not key.lower().endswith(RASTER_IMAGE_EXTENSIONS):
            log.warning(
                "ai_grading_image_skipped", session_id=str(session_id), task=task.number, key=key
            )
        elif key is not None:
            task = replace(task, image=await runner.read_image(key))
        tasks.append(task)
    return tasks


async def _record_attempt(
    runner: GradingRunner, session_id: uuid.UUID, entry: dict[str, Any]
) -> None:
    settings = get_settings()
    async with runner.factory() as db:
        await db.execute(
            update(AIAssessment)
            .where(
                AIAssessment.test_session_id == session_id,
                AIAssessment.status == AssessmentStatus.PROCESSING,
            )
            .values(
                attempts=entry["attempt"],
                model=settings.ai_model,
                prompt_version=PROMPT_VERSION,
                raw_responses=AIAssessment.raw_responses.op("||", return_type=JSONB)(
                    type_coerce([entry], JSONB)
                ),
            )
        )
        await db.commit()


def _first_line(exc: Exception) -> str:
    # Validation messages carry the model's text, which may quote the essay: log one line.
    return str(exc).split("\n", 1)[0]


async def _call(
    runner: GradingRunner, session_id: uuid.UUID, tasks: list[TaskInput]
) -> ModelOutput | Exception:
    """Up to `ai_max_attempts` attempts; the last error if none gives a usable grade."""
    settings = get_settings()
    numbers = {t.number for t in tasks}
    error: Exception = RuntimeError("no attempt made")
    for attempt in range(1, settings.ai_max_attempts + 1):
        if attempt > 1:
            await asyncio.sleep(settings.ai_backoff_seconds * 4 ** (attempt - 2))
        request = build_request(
            tasks,
            model=settings.ai_model,
            max_tokens=settings.ai_max_output_tokens,
            temperature=settings.ai_temperature,
            ignore_providers=settings.ai_provider_ignore,
        )
        entry: dict[str, Any] = {"attempt": attempt, "at": _now().isoformat()}
        body: Any = None
        try:
            body = await runner.client.chat(request)
            output = parse_output(body, numbers)
        except AIClientError as exc:
            error, entry["error"], entry["response"] = exc, str(exc), exc.body
        except OutputError as exc:
            error, entry["error"], entry["response"] = exc, str(exc), body
        else:
            entry["response"] = body
            await _record_attempt(runner, session_id, entry)
            return output
        await _record_attempt(runner, session_id, entry)
        log.warning(
            "ai_grading_attempt_failed",
            session_id=str(session_id),
            attempt=attempt,
            error=_first_line(error),
        )
    return error


def _graded_task(number: int, task: ModelTask, words: int) -> tuple[WritingTask, list[Decimal]]:
    criteria = [
        WritingCriterion(
            criterion=c.criterion,
            band=c.band,
            comments=[
                WritingComment(comment=x.comment, quote=x.quote, suggestion=x.suggestion)
                for x in c.comments
            ],
        )
        for c in task.criteria
    ]
    bands = [c.band for c in task.criteria]
    return WritingTask(number=number, band=None, word_count=words, criteria=criteria), bands


def _blank_task(number: int, mode: SessionMode) -> WritingTask:
    criteria = (
        [WritingCriterion(criterion=c, band=Decimal(0), comments=[]) for c in TASK_CRITERIA[number]]
        if mode == SessionMode.EXAM
        else []
    )
    return WritingTask(number=number, band=None, word_count=0, criteria=criteria)


async def _finish(
    runner: GradingRunner, session_id: uuid.UUID, values: dict[str, Any], band: Decimal | None
) -> bool:
    """The outcome, written only if the row is still `processing`; a `ready` outcome also
    sets the session's band."""
    async with runner.factory() as db:
        updated = await db.scalar(
            update(AIAssessment)
            .where(
                AIAssessment.test_session_id == session_id,
                AIAssessment.status == AssessmentStatus.PROCESSING,
            )
            .values(completed_at=_now(), **values)
            .returning(AIAssessment.id)
        )
        if updated is not None and values["status"] == AssessmentStatus.READY:
            await db.execute(
                update(TestSession).where(TestSession.id == session_id).values(band=band)
            )
        await db.commit()
        return updated is not None


async def grade_session(runner: GradingRunner, session_id: uuid.UUID) -> AssessmentStatus | None:
    """Grade a submitted Writing session whose assessment is `processing`; the outcome, or
    `None` if there was nothing to do."""
    async with runner.semaphore:
        async with runner.factory() as db:
            found = await _load(db, session_id)
        if found is None:
            return None
        loaded, signals = found

        output: ModelOutput | None = None
        if loaded.tasks:
            outcome = await _call(
                runner, session_id, await _with_images(runner, session_id, loaded)
            )
            if isinstance(outcome, Exception):
                if await _finish(
                    runner,
                    session_id,
                    {"status": AssessmentStatus.FAILED, "error": str(outcome)},
                    None,
                ):
                    log.error(
                        "ai_grading_failed", session_id=str(session_id), error=_first_line(outcome)
                    )
                    return AssessmentStatus.FAILED
                return None
            output = outcome

        graded = {t.number: t for t in loaded.tasks}
        results: list[WritingTask] = []
        criteria: dict[int, list[Decimal] | None] = {}
        for number in sorted(loaded.words):
            model_task = None
            if output is not None and number in graded:
                model_task = output.task1 if number == 1 else output.task2
            if model_task is None:
                results.append(_blank_task(number, loaded.mode))
                criteria[number] = None
                continue
            task = graded[number]
            model_task = check_quotes(model_task, task.essay.text)
            served, task_bands = _graded_task(number, model_task, task.words)
            signals += implausible_band_signals(
                number,
                task.words,
                task.min_words,
                {c.criterion: c.band for c in model_task.criteria},
            )
            results.append(served)
            criteria[number] = task_bands
        if output is not None and output.manipulation_attempt:
            signals.append(Signal(SignalSource.MODEL, None, output.manipulation_evidence or ""))

        bands = writing_bands(loaded.mode, criteria)
        per_task = {1: bands.task1, 2: bands.task2}
        results = [r.model_copy(update={"band": per_task.get(r.number)}) for r in results]
        result = WritingResult(tasks=results, focus=list(output.focus) if output else [])
        status = AssessmentStatus.HELD if signals else AssessmentStatus.READY
        values = {
            "status": status,
            "result": result.model_dump(mode="json"),
            "task1_band": bands.task1,
            "task2_band": bands.task2,
            "band": bands.overall,
            "signals": [s.to_json() for s in signals],
        }
        if not await _finish(runner, session_id, values, bands.overall):
            return None
        if status == AssessmentStatus.HELD:
            log.warning(
                "ai_grading_held",
                session_id=str(session_id),
                sources=sorted({s.source for s in signals}),
            )
        else:
            log.info("ai_grading_ready", session_id=str(session_id), band=str(bands.overall))
        return status


# Scheduling (spec §7.1, §7.2). In-process tasks die with the process; the startup resume
# re-runs whatever is still `processing`. Assumes a single app machine.
_runner: GradingRunner | None = None
# One task per session in flight; also the strong reference that keeps each task alive.
_tasks: dict[uuid.UUID, "asyncio.Task[None]"] = {}


def install(runner: GradingRunner | None) -> None:
    """The runner submissions grade with; `None` turns scheduling off."""
    global _runner
    _runner = runner


def installed() -> GradingRunner | None:
    return _runner


async def _run(runner: GradingRunner, session_id: uuid.UUID) -> None:
    try:
        await grade_session(runner, session_id)
    except Exception:
        # The row stays `processing`; the next startup tries again.
        log.exception("ai_grading_crashed", session_id=str(session_id))


def _schedule(runner: GradingRunner, session_ids: Iterable[uuid.UUID]) -> None:
    for session_id in session_ids:
        if session_id in _tasks:
            continue
        task = asyncio.create_task(_run(runner, session_id))
        _tasks[session_id] = task

        def forget(done: "asyncio.Task[None]", session_id: uuid.UUID = session_id) -> None:
            if _tasks.get(session_id) is done:
                del _tasks[session_id]

        task.add_done_callback(forget)


def schedule(session_ids: Iterable[uuid.UUID]) -> None:
    """Grade these sessions in the background, once each; a no-op with no runner installed.
    Call only after the transaction that created their rows has committed."""
    if _runner is not None:
        _schedule(_runner, session_ids)


async def drain() -> None:
    """Wait for every grading task in flight, including any they schedule."""
    while _tasks:
        await asyncio.gather(*_tasks.values(), return_exceptions=True)


async def shutdown() -> None:
    """Cancel the grading in flight (the rows stay `processing`) and stop scheduling."""
    tasks = list(_tasks.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    install(None)


async def resume_processing(runner: GradingRunner) -> int:
    """Schedule every `processing` assessment, e.g. after a restart killed its task. Never
    touches `ready`, `held` or `failed` rows, and never raises."""
    try:
        async with runner.factory() as db:
            ids = list(
                await db.scalars(
                    select(AIAssessment.test_session_id)
                    .where(AIAssessment.status == AssessmentStatus.PROCESSING)
                    .order_by(AIAssessment.created_at)
                )
            )
    except Exception:
        log.exception("ai_resume_failed")
        return 0
    _schedule(runner, ids)
    log.info("ai_resume_scheduled", count=len(ids))
    return len(ids)


@dataclass(frozen=True)
class RegradeCounts:
    ready: int
    held: int
    failed: int


async def regrade_failed(runner: GradingRunner) -> RegradeCounts:
    """Retry every `failed` assessment from scratch (spec §7.4), one at a time. `ready` and
    `held` rows are never touched."""
    async with runner.factory() as db:
        ids = list(
            await db.scalars(
                update(AIAssessment)
                .where(AIAssessment.status == AssessmentStatus.FAILED)
                .values(
                    status=AssessmentStatus.PROCESSING, attempts=0, error=None, completed_at=None
                )
                .returning(AIAssessment.test_session_id)
            )
        )
        await db.commit()
    outcomes = [await grade_session(runner, session_id) for session_id in ids]
    return RegradeCounts(
        ready=outcomes.count(AssessmentStatus.READY),
        held=outcomes.count(AssessmentStatus.HELD),
        failed=outcomes.count(AssessmentStatus.FAILED),
    )
