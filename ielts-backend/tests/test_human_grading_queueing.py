"""How Writing reaches the teacher queue (human grading spec §4, §4.1)."""

from collections.abc import Awaitable, Callable

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.models import (
    AIAssessment,
    AssessmentStatus,
    HumanGrade,
    SessionMode,
    Skill,
    TestSession,
    User,
)
from core.schemas.session import AnswerInput
from core.services import sessions
from core.services.ai_grading import GradingRunner, regrade_failed
from core.settings import get_settings
from tests.ai_helpers import FakeOpenRouter, completion, model_output
from tests.helpers import publish_test
from tests.test_ai_grading import BOTH, NOW, graded, rows

MakeUser = Callable[..., Awaitable[tuple[User, str]]]
Runner = tuple[GradingRunner, FakeOpenRouter]


async def queued(engine: AsyncEngine, ts: TestSession) -> HumanGrade | None:
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        grade: HumanGrade | None = await db.scalar(
            select(HumanGrade).where(HumanGrade.test_session_id == ts.id)
        )
        return grade


async def test_requested_manual_grading_is_queued(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    user, _ = await make_user()
    v = await publish_test(db_session, Skill.WRITING)
    ts = await sessions.start_session(db_session, user, v.test_id, SessionMode.EXAM, NOW)
    await sessions.set_manual_grading(db_session, user, ts.id, True, NOW)
    inputs = [AnswerInput(question=q, value=e) for q, e in BOTH.items()]
    await sessions.save_answers(db_session, user, ts.id, inputs, NOW)
    await sessions.submit_session(db_session, user, ts.id, NOW)

    grade = await queued(_engine, ts)
    assert grade is not None
    assert (grade.skill, grade.origin, grade.status) == (
        "writing",
        "student_request",
        "awaiting_grader",
    )
    async with async_sessionmaker(_engine)() as db:
        assessment = await db.scalar(
            select(AIAssessment).where(AIAssessment.test_session_id == ts.id)
        )
    assert assessment is None


async def test_ai_final_failure_hands_to_teacher(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    user, _ = await make_user()
    ts = await graded(db_session, user, ai_runner, AssessmentStatus.FAILED)
    row, _ = await rows(_engine, ts)
    assert row.status == AssessmentStatus.FAILED
    grade = await queued(_engine, ts)
    assert grade is not None and (grade.origin, grade.status) == ("ai_fallback", "awaiting_grader")


async def test_ai_failure_without_fallback_stays_failed(
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    ai_runner: Runner,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "ai_failure_fallback_to_teacher", False)
    user, _ = await make_user()
    ts = await graded(db_session, user, ai_runner, AssessmentStatus.FAILED)
    assert await queued(_engine, ts) is None


async def test_held_essay_hands_to_teacher(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    user, _ = await make_user()
    ts = await graded(db_session, user, ai_runner, AssessmentStatus.HELD)
    row, session = await rows(_engine, ts)
    assert row.status == AssessmentStatus.HELD and session.band is None
    grade = await queued(_engine, ts)
    assert grade is not None and (grade.origin, grade.status) == ("ai_flagged", "awaiting_grader")


async def test_handed_over_session_is_never_regraded(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    runner, fake = ai_runner
    user, _ = await make_user()
    ts = await graded(db_session, user, ai_runner, AssessmentStatus.FAILED)
    assert await queued(_engine, ts) is not None
    fake.requests.clear()
    # Failed rows other tests left without a teacher would be retried; answer them.
    fake.default = completion(model_output())

    await regrade_failed(runner)

    # A retry would reset it to `processing` and the fake would grade it `ready`.
    row, session = await rows(_engine, ts)
    assert (row.status, row.attempts, session.band) == (AssessmentStatus.FAILED, 3, None)
