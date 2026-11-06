import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal as D

import pytest
from asgi_lifespan import LifespanManager
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.models import AIAssessment, AssessmentStatus, SessionMode, Skill, TestSession, User
from core.schemas.session import AnswerInput
from core.services import ai_grading, sessions
from core.services.ai_grading import GradingRunner, regrade_failed, resume_processing
from core.settings import get_settings
from tests.ai_helpers import FakeOpenRouter, completion, model_output
from tests.helpers import publish_test
from tests.test_ai_grading import BOTH, RecordingLog, graded, rows

MakeUser = Callable[..., Awaitable[tuple[User, str]]]
Runner = tuple[GradingRunner, FakeOpenRouter]
NOW = datetime(2026, 10, 29, 9, 0, tzinfo=UTC)
# Earlier than any other test's sessions, so an auto-submit sweep at EARLY + 2 h submits
# only this file's sessions.
EARLY = datetime(2019, 3, 1, 9, 0, tzinfo=UTC)


async def started(
    db: AsyncSession, user: User, skill: Skill = Skill.WRITING, at: datetime = NOW
) -> TestSession:
    v = await publish_test(db, skill)
    ts = await sessions.start_session(db, user, v.test_id, SessionMode.EXAM, at)
    if skill == Skill.WRITING:
        inputs = [AnswerInput(question=q, value=e) for q, e in BOTH.items()]
        await sessions.save_answers(db, user, ts.id, inputs, at)
    return ts


async def assessment(engine: AsyncEngine, session_id: uuid.UUID) -> AIAssessment | None:
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        row: AIAssessment | None = await db.scalar(
            select(AIAssessment).where(AIAssessment.test_session_id == session_id)
        )
        return row


async def test_submit_creates_row_in_same_transaction(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    user, _ = await make_user()
    ai = await started(db_session, user)
    manual = await started(db_session, user)
    await sessions.set_manual_grading(db_session, user, manual.id, True, NOW)
    reading = await started(db_session, user, Skill.READING)
    for ts in (ai, manual, reading):
        await sessions.submit_session(db_session, user, ts.id, NOW)

    row = await assessment(_engine, ai.id)
    assert row is not None and row.status == AssessmentStatus.PROCESSING
    assert await assessment(_engine, manual.id) is None
    assert await assessment(_engine, reading.id) is None


async def test_every_submit_route_schedules(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.default = completion(model_output())
    user, _ = await make_user()
    by_student = await started(db_session, user, at=EARLY)
    by_read = await started(db_session, user, at=EARLY)
    by_sweep = await started(db_session, user, at=EARLY)
    later = EARLY + timedelta(hours=2)

    await sessions.submit_session(db_session, user, by_student.id, EARLY)
    await sessions.get_session(db_session, user, by_read.id, later)
    await sessions.auto_submit_expired(db_session, later)
    await ai_grading.drain()

    for ts in (by_student, by_read, by_sweep):
        row = await assessment(_engine, ts.id)
        assert row is not None and row.status == AssessmentStatus.READY


async def test_schedule_without_runner_is_noop(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    user, _ = await make_user()
    ts = await started(db_session, user)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    await ai_grading.drain()

    row = await assessment(_engine, ts.id)
    assert row is not None and row.status == AssessmentStatus.PROCESSING


async def test_schedule_dedupes_in_flight(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    release = asyncio.Event()
    fake.responses = [release, completion(model_output())]
    user, _ = await make_user()
    ts = await started(db_session, user)

    await sessions.submit_session(db_session, user, ts.id, NOW)
    await asyncio.wait_for(fake.called.wait(), 10)
    ai_grading.schedule([ts.id])
    ai_grading.schedule([ts.id])
    release.set()
    await ai_grading.drain()

    assert len(fake.requests) == 1
    row = await assessment(_engine, ts.id)
    assert row is not None and row.status == AssessmentStatus.READY


async def test_resume_processing_only(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    runner, fake = ai_runner
    # Other tests' processing rows are resumed too; answer them all.
    fake.default = completion(model_output())
    user, _ = await make_user()
    by_status: dict[AssessmentStatus, TestSession] = {}
    for day, status in enumerate(AssessmentStatus):
        # one a day: the free plan allows three Writing tests a day
        at = NOW + timedelta(days=day)
        ts = await started(db_session, user, at=at)
        await sessions.submit_session(db_session, user, ts.id, at)
        await db_session.execute(
            update(AIAssessment)
            .where(AIAssessment.test_session_id == ts.id)
            .values(status=status, attempts=7)
        )
        by_status[status] = ts
    await db_session.commit()

    assert await resume_processing(runner) >= 1
    await ai_grading.drain()

    for status, ts in by_status.items():
        row = await assessment(_engine, ts.id)
        assert row is not None
        if status == AssessmentStatus.PROCESSING:
            assert row.status == AssessmentStatus.READY
        else:
            assert (row.status, row.attempts) == (status, 7)


async def test_resume_processing_never_raises(
    ai_runner: Runner, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner, _ = ai_runner

    def broken() -> None:
        raise RuntimeError("database down")

    monkeypatch.setattr(runner, "factory", broken)
    assert await resume_processing(runner) == 0


async def test_crash_logged_row_stays_processing(
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    ai_installed: Runner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    log = RecordingLog()
    monkeypatch.setattr(ai_grading, "log", log)

    async def boom(runner: GradingRunner, session_id: uuid.UUID) -> None:
        raise RuntimeError("bug")

    monkeypatch.setattr(ai_grading, "grade_session", boom)
    user, _ = await make_user()
    ts = await started(db_session, user)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    await ai_grading.drain()

    assert "ai_grading_crashed" in log.names()
    row = await assessment(_engine, ts.id)
    assert row is not None and row.status == AssessmentStatus.PROCESSING


async def test_lifespan_installs_and_resumes(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.main

    resumed: list[GradingRunner] = []
    called = asyncio.Event()

    async def fake_resume(runner: GradingRunner) -> int:
        resumed.append(runner)
        called.set()
        return 0

    monkeypatch.setattr(get_settings(), "ai_grading_enabled", True)
    monkeypatch.setattr(get_settings(), "ai_resume_on_startup", True)
    monkeypatch.setattr(api.main, "resume_processing", fake_resume)
    async with LifespanManager(api.main.create_app()):
        await asyncio.wait_for(called.wait(), timeout=1)
        assert ai_grading.installed() is resumed[0]
    assert ai_grading.installed() is None


async def test_lifespan_skips_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.main

    resumed: list[GradingRunner] = []

    async def fake_resume(runner: GradingRunner) -> int:
        resumed.append(runner)
        return 0

    monkeypatch.setattr(api.main, "resume_processing", fake_resume)
    monkeypatch.setattr(get_settings(), "ai_grading_enabled", False)
    monkeypatch.setattr(get_settings(), "ai_resume_on_startup", True)
    async with LifespanManager(api.main.create_app()):
        assert ai_grading.installed() is None
    monkeypatch.setattr(get_settings(), "ai_grading_enabled", True)
    monkeypatch.setattr(get_settings(), "ai_resume_on_startup", False)
    async with LifespanManager(api.main.create_app()):
        assert ai_grading.installed() is not None
    assert resumed == []


async def test_regrade_failed_only(
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    ai_runner: Runner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # With the fallback on, a failed essay goes to a teacher and is never retried
    # (test_human_grading_queueing); with it off, regrade-ai still retries it.
    monkeypatch.setattr(get_settings(), "ai_failure_fallback_to_teacher", False)
    runner, fake = ai_runner
    user, _ = await make_user()
    failed = await graded(db_session, user, ai_runner, AssessmentStatus.FAILED)
    ready = await graded(db_session, user, ai_runner, AssessmentStatus.READY)
    held = await graded(db_session, user, ai_runner, AssessmentStatus.HELD)
    before = {ts.id: (await rows(_engine, ts))[0] for ts in (ready, held)}
    fake.requests.clear()
    # Other tests' failed rows are retried too; answer them all.
    fake.default = completion(model_output())

    counts = await regrade_failed(runner)

    assert counts.ready >= 1
    row, session = await rows(_engine, failed)
    assert row.status == AssessmentStatus.READY and row.error is None
    assert row.attempts == 1 and session.band == D("6.0")
    for ts in (ready, held):
        after, _ = await rows(_engine, ts)
        assert (after.status, after.updated_at) == (before[ts.id].status, before[ts.id].updated_at)
