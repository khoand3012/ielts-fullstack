"""Grade recording: the only code that writes a session's grade (`test_sessions.raw_score`
and `band`).

- Reading/Listening: `record_auto_score` marks a submitted session and stores its score. A
  marking failure is logged and leaves the session unscored; the startup sweep retries.
- Writing graded by AI: `record_ai_outcome` moves an assessment out of the status it is
  expected to be in; only a `ready` outcome gives the session its band, taken from the
  assessment row itself.
- Human grading (phase 8) records teacher grades here too.

Nothing here commits: callers own their transactions.
"""

import uuid
from typing import Any

import structlog
from sqlalchemy import ColumnElement, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    AIAssessment,
    Answer,
    AssessmentStatus,
    Module,
    SessionMode,
    Skill,
    TestSession,
    TestVersion,
)
from core.services import auto_grading, catalog
from core.services.content import item_index

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
    if values["status"] == AssessmentStatus.READY:
        await db.execute(update(TestSession).where(TestSession.id == session_id).values(band=band))
    return session_id
