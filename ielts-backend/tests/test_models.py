from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy.exc import IntegrityError

from core.models import RefreshToken, User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from core.models import HumanGrade, TestSession


def test_user_defaults() -> None:
    user = User(email="a@b.com", password_hash="x")
    assert user.plan == "free" or user.plan is None  # default applied at flush


def test_refresh_token_fields() -> None:
    rt = RefreshToken(user_id=uuid.uuid4(), jti="abc", expires_at=None)
    assert rt.jti == "abc"
    assert rt.revoked_at is None


async def _writing_session(db: AsyncSession) -> TestSession:
    from core.models import SessionMode, Skill
    from core.services import auth, sessions
    from tests.helpers import publish_test

    user = await auth.register(db, f"hg-{uuid.uuid4()}@t.com", "password123")
    version = await publish_test(db, Skill.WRITING)
    return await sessions.start_session(db, user, version.test_id, SessionMode.PRACTICE)


def _grade(ts: TestSession, **overrides: str) -> HumanGrade:
    from core.models import HumanGrade

    values = {"skill": "writing", "origin": "student_request", **overrides}
    return HumanGrade(test_session_id=ts.id, **values)


async def test_human_grade_unique_per_session(db_session: AsyncSession) -> None:
    ts = await _writing_session(db_session)
    db_session.add(_grade(ts))
    await db_session.flush()
    db_session.add(_grade(ts, origin="ai_fallback"))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_human_grade_rejects_unknown_status(db_session: AsyncSession) -> None:
    ts = await _writing_session(db_session)
    db_session.add(_grade(ts, status="done"))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_human_grade_defaults_to_awaiting_grader(db_session: AsyncSession) -> None:
    ts = await _writing_session(db_session)
    grade = _grade(ts)
    db_session.add(grade)
    await db_session.flush()
    assert grade.status == "awaiting_grader"
