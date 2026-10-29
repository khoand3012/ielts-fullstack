from collections.abc import Awaitable, Callable
from decimal import Decimal as D

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from core.exceptions import ForbiddenError, NotFoundError
from core.models import AIAssessment, AssessmentStatus, Role, SignalSource, TestSession, User
from core.services import ai_review
from core.services.ai_grading import GradingRunner, grade_session, regrade_failed
from tests.ai_helpers import FakeOpenRouter, completion, model_output
from tests.test_ai_grading import BOTH, ESSAY1, ESSAY2, rows, submitted

MakeUser = Callable[..., Awaitable[tuple[User, str]]]
Runner = tuple[GradingRunner, FakeOpenRouter]


async def graded(
    db: AsyncSession, user: User, runner: Runner, status: AssessmentStatus
) -> TestSession:
    """A Writing session graded to `status` (ready, held or failed)."""
    ts = await submitted(db, user, BOTH)
    _, fake = runner
    if status == AssessmentStatus.FAILED:
        fake.responses = [completion("not json")] * 3
    else:
        fake.responses = [completion(model_output(manipulation=status == AssessmentStatus.HELD))]
    assert await grade_session(runner[0], ts.id) == status
    return ts


async def test_regrade_failed_only(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
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


async def test_list_and_show_held(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    user, _ = await make_user()
    held = await graded(db_session, user, ai_runner, AssessmentStatus.HELD)
    ready = await graded(db_session, user, ai_runner, AssessmentStatus.READY)
    row, _ = await rows(_engine, held)

    [item] = [i for i in await ai_review.list_held(db_session) if i.session_id == held.id]
    assert (item.assessment_id, item.email) == (row.id, user.email)
    assert [s["source"] for s in item.signals] == [SignalSource.MODEL]
    assert (item.band, item.task1_band, item.task2_band) == (D("6.0"), D("6.0"), D("6.0"))
    assert ready.id not in {i.session_id for i in await ai_review.list_held(db_session)}

    shown, essays = await ai_review.get_held(db_session, row.id)
    assert shown == item and essays == {1: ESSAY1, 2: ESSAY2}
    ready_row, _ = await rows(_engine, ready)
    with pytest.raises(NotFoundError):
        await ai_review.get_held(db_session, ready_row.id)


async def test_release_held(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    student, _ = await make_user()
    admin, _ = await make_user(Role.ADMIN)
    ts = await graded(db_session, student, ai_runner, AssessmentStatus.HELD)
    row, _ = await rows(_engine, ts)

    with pytest.raises(ForbiddenError):
        await ai_review.release_held(db_session, row.id, student.email)
    with pytest.raises(NotFoundError):
        await ai_review.release_held(db_session, row.id, "nobody@t.com")
    assert (await rows(_engine, ts))[0].status == AssessmentStatus.HELD

    await ai_review.release_held(db_session, row.id, admin.email)
    released, session = await rows(_engine, ts)
    assert released.status == AssessmentStatus.READY
    assert released.released_by == admin.id and released.released_at is not None
    assert session.band == D("6.0")

    with pytest.raises(NotFoundError):
        await ai_review.release_held(db_session, row.id, admin.email)


async def test_release_ignores_rows_changed_since(
    db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser, ai_runner: Runner
) -> None:
    student, _ = await make_user()
    admin, _ = await make_user(Role.ADMIN)
    ts = await graded(db_session, student, ai_runner, AssessmentStatus.HELD)
    row, _ = await rows(_engine, ts)
    await db_session.execute(
        update(AIAssessment).where(AIAssessment.id == row.id).values(status="failed")
    )
    await db_session.commit()

    with pytest.raises(NotFoundError):
        await ai_review.release_held(db_session, row.id, admin.email)
    assert (await rows(_engine, ts))[1].band is None
