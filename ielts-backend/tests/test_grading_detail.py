"""What a teacher sees when grading, and their private drafts (human grading spec §5.2)."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.ai.injection import clean_essay, word_count
from core.models import AssessmentStatus, HumanGrade, Role
from core.services.ai_grading import GradingRunner
from tests.ai_helpers import FakeOpenRouter
from tests.grading_helpers import MakeUser, grade_of, h, requested
from tests.test_ai_grading import ESSAY2, graded

Runner = tuple[GradingRunner, FakeOpenRouter]


@pytest.fixture(autouse=True)
def fake_signing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def signed(key: str) -> str:
        return f"https://signed/{key}"

    monkeypatch.setattr("core.services.storage.signed_get_url", signed)


async def claimed(
    client: AsyncClient, engine: AsyncEngine, db: AsyncSession, make_user: MakeUser, **kw: Any
) -> tuple[HumanGrade, str]:
    """A requested Writing grade claimed by a new teacher, and that teacher's token."""
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db, make_user, **kw)
    grade = await grade_of(engine, ts)
    resp = await client.post(f"/grading/{grade.id}/claim", headers=h(tok))
    assert resp.status_code == 200, resp.text
    return grade, tok


def task(body: dict[str, Any], number: int) -> dict[str, Any]:
    return next(t for t in body["tasks"] if t["number"] == number)


async def test_detail_has_prompts_essays_and_word_counts(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)

    resp = await app_client.get(f"/grading/{grade.id}", headers=h(tok))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["grade_id"], body["status"], body["mode"]) == (
        str(grade.id),
        "claimed",
        "practice",
    )
    one, two = task(body, 1), task(body, 2)
    assert one["image_url"] == "https://signed/tests/f/task1.png"
    assert one["prompt"] and one["min_words"] == 150
    assert two["text"] == ESSAY2
    assert two["word_count"] == word_count(clean_essay(ESSAY2).text)
    assert two["image_url"] is None
    assert body["draft"] is None and body["ai"] is None


async def test_blank_task_has_empty_text_and_zero_words(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user, essays={2: ESSAY2})

    body = (await app_client.get(f"/grading/{grade.id}", headers=h(tok))).json()

    assert (task(body, 1)["text"], task(body, 1)["word_count"]) == ("", 0)
    assert task(body, 2)["word_count"] > 0


async def test_flagged_detail_shows_ai_draft_and_signals(
    app_client: AsyncClient,
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    ai_runner: Runner,
) -> None:
    _, tok = await make_user(Role.TEACHER)
    student, _ = await make_user()
    ts = await graded(db_session, student, ai_runner, AssessmentStatus.HELD)
    grade = await grade_of(_engine, ts)
    assert grade.origin == "ai_flagged"
    assert (await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok))).status_code == 200

    body = (await app_client.get(f"/grading/{grade.id}", headers=h(tok))).json()

    assert body["ai"]["signals"]
    assert body["ai"]["band"] is not None
    assert body["ai"]["result"]["tasks"]


async def test_detail_forbidden_to_other_teacher(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, _ = await claimed(app_client, _engine, db_session, make_user)
    _, other = await make_user(Role.TEACHER)
    assert (await app_client.get(f"/grading/{grade.id}", headers=h(other))).status_code == 403


async def test_detail_open_to_admin(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, _ = await claimed(app_client, _engine, db_session, make_user)
    _, admin = await make_user(Role.ADMIN)
    assert (await app_client.get(f"/grading/{grade.id}", headers=h(admin))).status_code == 200


async def test_detail_unknown_grade(app_client: AsyncClient, make_user: MakeUser) -> None:
    _, tok = await make_user(Role.TEACHER)
    resp = await app_client.get("/grading/00000000-0000-7000-8000-000000000000", headers=h(tok))
    assert resp.status_code == 404


PARTIAL = {
    "tasks": [
        {
            "number": 2,
            "criteria": {"task_response": {"band": 6.5, "comment": None}},
            "feedback": None,
        }
    ]
}


async def test_draft_round_trip(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)

    resp = await app_client.put(f"/grading/{grade.id}/draft", json=PARTIAL, headers=h(tok))

    assert resp.status_code == 200, resp.text
    assert resp.json() == PARTIAL
    body = (await app_client.get(f"/grading/{grade.id}", headers=h(tok))).json()
    assert body["draft"] == PARTIAL


async def test_draft_rejects_bad_band(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)
    bad = {"tasks": [{"number": 2, "criteria": {"task_response": {"band": 6.3}}}]}
    resp = await app_client.put(f"/grading/{grade.id}/draft", json=bad, headers=h(tok))
    assert resp.status_code == 422


async def test_draft_rejects_wrong_criterion_for_task(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)
    bad = {"tasks": [{"number": 1, "criteria": {"task_response": {"band": 6}}}]}
    resp = await app_client.put(f"/grading/{grade.id}/draft", json=bad, headers=h(tok))
    assert resp.status_code == 422


async def test_draft_only_by_claimant(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, _ = await claimed(app_client, _engine, db_session, make_user)
    _, other = await make_user(Role.TEACHER)
    resp = await app_client.put(f"/grading/{grade.id}/draft", json=PARTIAL, headers=h(other))
    assert resp.status_code == 403
    async with async_sessionmaker(_engine)() as db:
        assert await db.scalar(select(HumanGrade.scores).where(HumanGrade.id == grade.id)) is None


async def test_draft_after_release_refused(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)
    assert (
        await app_client.post(f"/grading/{grade.id}/release", headers=h(tok))
    ).status_code == 204
    resp = await app_client.put(f"/grading/{grade.id}/draft", json=PARTIAL, headers=h(tok))
    assert resp.status_code == 403  # no longer the caller's claim
