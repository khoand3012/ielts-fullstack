from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from uuid_utils.compat import uuid7

from core.models import (
    AIAssessment,
    AssessmentStatus,
    Test,
    TestSession,
    TestVersion,
    User,
)

MakeUser = Callable[..., Awaitable[tuple[User, str]]]


async def _writing_session(db: AsyncSession, user: User) -> TestSession:
    test = Test(skill="writing", slug=f"w-{uuid7()}", title="W")
    db.add(test)
    await db.flush()
    version = TestVersion(test_id=test.id, version=1, status="published", content={})
    db.add(version)
    await db.flush()
    ts = TestSession(
        user_id=user.id,
        test_version_id=version.id,
        skill="writing",
        mode="practice",
        started_at=datetime.now(UTC),
    )
    db.add(ts)
    await db.flush()
    return ts


async def test_assessment_status_check(db_session: AsyncSession, make_user: MakeUser) -> None:
    user, _ = await make_user()
    ts = await _writing_session(db_session, user)
    db_session.add(AIAssessment(test_session_id=ts.id, status="done"))
    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.parametrize("status", list(AssessmentStatus))
async def test_assessment_status_values_accepted(
    db_session: AsyncSession, make_user: MakeUser, status: AssessmentStatus
) -> None:
    user, _ = await make_user()
    ts = await _writing_session(db_session, user)
    db_session.add(AIAssessment(test_session_id=ts.id, status=status))
    await db_session.flush()


async def test_one_assessment_per_session(db_session: AsyncSession, make_user: MakeUser) -> None:
    user, _ = await make_user()
    ts = await _writing_session(db_session, user)
    db_session.add_all([AIAssessment(test_session_id=ts.id), AIAssessment(test_session_id=ts.id)])
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_assessment_defaults(_engine: AsyncEngine, make_user: MakeUser) -> None:
    factory = async_sessionmaker(_engine, expire_on_commit=False)
    user, _ = await make_user()
    async with factory() as db:
        ts = await _writing_session(db, user)
        db.add(AIAssessment(test_session_id=ts.id))
        await db.commit()
    async with factory() as db:
        row = await db.scalar(select(AIAssessment).where(AIAssessment.test_session_id == ts.id))
        assert row is not None
        assert row.status == AssessmentStatus.PROCESSING
        assert row.attempts == 0
        assert row.raw_responses == []
        assert row.signals == []
        assert row.model is None
        assert row.prompt_version is None


async def test_assessment_deleted_with_session(
    db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, _ = await make_user()
    ts = await _writing_session(db_session, user)
    db_session.add(AIAssessment(test_session_id=ts.id))
    await db_session.flush()
    await db_session.execute(delete(TestSession).where(TestSession.id == ts.id))
    rows = await db_session.scalars(
        select(AIAssessment).where(AIAssessment.test_session_id == ts.id)
    )
    assert list(rows) == []
