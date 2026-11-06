"""Grade recording: the only code that writes a session's grade (`test_sessions.raw_score`
and `band`).

- Reading/Listening: `record_auto_score` marks a submitted session and stores its score. A
  marking failure is logged and leaves the session unscored; the startup sweep retries.
- Writing graded by AI: `record_ai_outcome` moves an assessment out of the status it is
  expected to be in; only a `ready` outcome gives the session its band, taken from the
  assessment row itself. A `held` outcome, and a `failed` one unless
  `ai_failure_fallback_to_teacher` is off, hands the session to the teacher queue.
- Teacher grading: `enqueue_human` puts a session in the teacher queue (once, however often
  it is called); `record_human_grade` writes the claiming teacher's grade and gives the
  session its band. A grade is final: it is written once.

Nothing here commits: callers own their transactions.
"""

import uuid
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import ColumnElement, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    AIAssessment,
    Answer,
    AssessmentStatus,
    HumanGrade,
    HumanGradeOrigin,
    HumanGradeStatus,
    Module,
    SessionMode,
    Skill,
    TestSession,
    TestVersion,
)
from core.services import auto_grading, catalog
from core.services.bands import WritingBands
from core.services.content import item_index
from core.settings import get_settings

log = structlog.get_logger()


def mark_session(
    ts: TestSession, version: TestVersion, answers: dict[int, Any]
) -> auto_grading.Score:
    """Score a Reading/Listening session against its own version's key and module. Stores
    nothing."""
    skill = Skill(ts.skill)
    return auto_grading.score(
        skill,
        Module(version.module) if version.module else None,
        SessionMode(ts.mode),
        item_index(skill, catalog.load_content(skill, version)),
        catalog.load_answer_key(version),
        answers,
    )


async def record_auto_score(db: AsyncSession, ts: TestSession) -> auto_grading.Score | None:
    """Mark a submitted Reading/Listening session and store its score on `ts`; `None` if
    marking threw. Only marking is guarded: a database error still propagates, because a
    swallowed one would abort the caller's transaction anyway."""
    version = await db.get(TestVersion, ts.test_version_id)
    assert version is not None  # FK
    rows = await db.scalars(select(Answer).where(Answer.test_session_id == ts.id))
    answers = {a.question_number: a.value for a in rows}
    try:
        score = mark_session(ts, version, answers)
    except Exception:
        # A scoring bug must never block a submission; the startup sweep scores it later.
        log.exception("auto_grading_failed", session_id=str(ts.id))
        return None
    ts.raw_score = score.raw_score
    ts.band = score.band
    return score


async def record_ai_outcome(
    db: AsyncSession,
    which: ColumnElement[bool],
    *,
    expected: AssessmentStatus,
    values: dict[str, Any],
) -> uuid.UUID | None:
    """Write `values` (which must include the new `status`) to the assessment matching
    `which`, only if it is still `expected`. A `ready` outcome also sets the session's band
    to the assessment's band. Returns the session id, or `None` if the assessment was not in
    the expected status (someone else got there first)."""
    moved = (
        (
            await db.execute(
                update(AIAssessment)
                .where(which, AIAssessment.status == expected)
                .values(**values)
                .returning(AIAssessment.test_session_id, AIAssessment.band)
            )
        )
        .tuples()
        .first()
    )
    if moved is None:
        return None
    session_id, band = moved
    status = values["status"]
    if status == AssessmentStatus.READY:
        await db.execute(update(TestSession).where(TestSession.id == session_id).values(band=band))
    elif status == AssessmentStatus.HELD:
        await enqueue_human(db, session_id, Skill.WRITING, HumanGradeOrigin.AI_FLAGGED)
    elif status == AssessmentStatus.FAILED and get_settings().ai_failure_fallback_to_teacher:
        await enqueue_human(db, session_id, Skill.WRITING, HumanGradeOrigin.AI_FALLBACK)
    return session_id


async def enqueue_human(
    db: AsyncSession, session_id: uuid.UUID, skill: Skill, origin: HumanGradeOrigin
) -> bool:
    """Put a session in the teacher queue; False if it is already there (or was graded)."""
    inserted = await db.scalar(
        insert(HumanGrade)
        .values(test_session_id=session_id, skill=skill, origin=origin)
        .on_conflict_do_nothing(index_elements=[HumanGrade.test_session_id])
        .returning(HumanGrade.id)
    )
    if inserted is not None:
        log.info("human_grading_queued", session_id=str(session_id), origin=str(origin))
    return inserted is not None


async def record_human_grade(
    db: AsyncSession,
    grade_id: uuid.UUID,
    teacher_id: uuid.UUID,
    scores: dict[str, Any],
    bands: WritingBands,
    now: datetime,
) -> uuid.UUID | None:
    """Write a teacher's grade, only if `teacher_id` still holds the claim, and set the
    session's band to the overall. Returns the session id, or `None` if nothing moved."""
    session_id = await db.scalar(
        update(HumanGrade)
        .where(
            HumanGrade.id == grade_id,
            HumanGrade.status == HumanGradeStatus.CLAIMED,
            HumanGrade.claimed_by == teacher_id,
        )
        .values(
            status=HumanGradeStatus.GRADED,
            scores=scores,
            overall_band=bands.overall,
            graded_by=teacher_id,
            graded_at=now,
        )
        .returning(HumanGrade.test_session_id)
    )
    if session_id is None:
        return None
    await db.execute(
        update(TestSession).where(TestSession.id == session_id).values(band=bands.overall)
    )
    return session_id
