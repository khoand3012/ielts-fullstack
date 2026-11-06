"""Shared set-up for the teacher grading tests."""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.models import HumanGrade, SessionMode, Skill, TestSession, User
from core.schemas.session import AnswerInput
from core.services import sessions
from tests.helpers import publish_test
from tests.test_ai_grading import BOTH

MakeUser = Callable[..., Awaitable[tuple[User, str]]]
NOW = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)


def h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def requested(
    db: AsyncSession,
    make_user: MakeUser,
    at: datetime = NOW,
    essays: dict[int, str] | None = None,
    mode: SessionMode = SessionMode.PRACTICE,
    student: tuple[User, str] | None = None,
) -> tuple[TestSession, User, str]:
    """A Writing session that asked for a teacher, submitted at `at`, by a new student (the
    daily Writing limit is per student) unless `student` is given."""
    user, token = student or await make_user()
    v = await publish_test(db, Skill.WRITING)
    ts = await sessions.start_session(db, user, v.test_id, mode, at)
    await sessions.set_manual_grading(db, user, ts.id, True, at)
    answers = BOTH if essays is None else essays
    if answers:
        inputs = [AnswerInput(question=q, value=e) for q, e in answers.items()]
        await sessions.save_answers(db, user, ts.id, inputs, at)
    await sessions.submit_session(db, user, ts.id, at)
    return ts, user, token


async def grade_of(engine: AsyncEngine, ts: TestSession) -> HumanGrade:
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        grade = await db.scalar(select(HumanGrade).where(HumanGrade.test_session_id == ts.id))
        assert grade is not None
        return grade


async def queue(client: AsyncClient, token: str, skill: str | None = None) -> list[dict[str, Any]]:
    """The whole queue, every page (other tests leave grades in the shared database)."""
    items: list[dict[str, Any]] = []
    while True:
        params: dict[str, Any] = {"limit": 100, "offset": len(items)}
        if skill:
            params["skill"] = skill
        resp = await client.get("/grading/queue", params=params, headers=h(token))
        assert resp.status_code == 200, resp.text
        page = resp.json()
        items += page["items"]
        if len(items) >= page["total"] or not page["items"]:
            return items


def ids_in(items: list[dict[str, Any]], wanted: list[uuid.UUID]) -> list[str]:
    """The grade ids of `items` that are among `wanted`, in the order listed."""
    keep = {str(w) for w in wanted}
    return [i["grade_id"] for i in items if i["grade_id"] in keep]
