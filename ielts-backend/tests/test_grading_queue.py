"""The teacher queue, claims and releases (human grading spec §5.2 steps 1, 2 and 7)."""

import asyncio
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.models import AssessmentStatus, HumanGrade, Role
from core.services.ai_grading import GradingRunner
from core.settings import get_settings
from tests.ai_helpers import FakeOpenRouter
from tests.grading_helpers import NOW, MakeUser, grade_of, h, ids_in, queue, requested
from tests.test_ai_grading import graded

Runner = tuple[GradingRunner, FakeOpenRouter]


async def test_queue_oldest_submission_first(
    app_client: AsyncClient,
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    ai_runner: Runner,
) -> None:
    _, tok = await make_user(Role.TEACHER)
    later, _, _ = await requested(db_session, make_user, NOW + timedelta(hours=2))
    earlier, _, _ = await requested(db_session, make_user, NOW + timedelta(hours=1))
    latest, _, _ = await requested(db_session, make_user, NOW + timedelta(hours=3))
    # Submitted before all three (the helper's fixed time), handed over after them.
    student, _ = await make_user()
    fallback = await graded(db_session, student, ai_runner, AssessmentStatus.FAILED)
    grades = [await grade_of(_engine, ts) for ts in (fallback, earlier, later, latest)]

    items = await queue(app_client, tok)

    assert ids_in(items, [g.id for g in grades]) == [str(g.id) for g in grades]
    item = next(i for i in items if i["grade_id"] == str(grades[0].id))
    assert (item["origin"], item["status"], item["skill"]) == (
        "ai_fallback",
        "awaiting_grader",
        "writing",
    )
    assert item["student_email"] == student.email and item["test_title"]


async def test_queue_filters_by_skill_and_hides_claimed(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)
    assert str(grade.id) in {i["grade_id"] for i in await queue(app_client, tok, "writing")}
    assert str(grade.id) not in {i["grade_id"] for i in await queue(app_client, tok, "speaking")}

    resp = await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok))
    assert resp.status_code == 200, resp.text
    assert str(grade.id) not in {i["grade_id"] for i in await queue(app_client, tok)}


async def test_student_cannot_see_queue(app_client: AsyncClient, make_user: MakeUser) -> None:
    _, tok = await make_user()
    assert (await app_client.get("/grading/queue", headers=h(tok))).status_code == 403
    assert (await app_client.get("/grading/mine", headers=h(tok))).status_code == 403


async def test_claim_and_mine(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    teacher, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)

    resp = await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["grade_id"], body["status"]) == (str(grade.id), "claimed")
    assert body["claimed_at"] is not None
    mine = (await app_client.get("/grading/mine", headers=h(tok))).json()
    assert [i["grade_id"] for i in mine] == [str(grade.id)]
    stored = await grade_of(_engine, ts)
    assert (stored.status, stored.claimed_by) == ("claimed", teacher.id)


async def test_claim_unknown_grade(app_client: AsyncClient, make_user: MakeUser) -> None:
    _, tok = await make_user(Role.TEACHER)
    resp = await app_client.post(
        "/grading/00000000-0000-7000-8000-000000000000/claim", headers=h(tok)
    )
    assert resp.status_code == 404


async def test_cannot_claim_own_test(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    teacher = await make_user(Role.TEACHER)
    ts, _, tok = await requested(db_session, make_user, student=teacher)
    grade = await grade_of(_engine, ts)
    resp = await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok))
    assert resp.status_code == 403
    assert (await grade_of(_engine, ts)).status == "awaiting_grader"


async def test_claim_race_one_winner(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    _, tok_a = await make_user(Role.TEACHER)
    _, tok_b = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)

    a, b = await asyncio.gather(
        app_client.post(f"/grading/{grade.id}/claim", headers=h(tok_a)),
        app_client.post(f"/grading/{grade.id}/claim", headers=h(tok_b)),
    )

    assert sorted([a.status_code, b.status_code]) == [200, 409]
    loser = a if a.status_code == 409 else b
    assert loser.json()["error"]["code"] == "already_claimed"


async def test_claim_limit(
    app_client: AsyncClient,
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "teacher_max_active_claims", 2)
    _, tok = await make_user(Role.TEACHER)
    grades = [
        await grade_of(_engine, (await requested(db_session, make_user))[0]) for _ in range(3)
    ]

    responses = [await app_client.post(f"/grading/{g.id}/claim", headers=h(tok)) for g in grades]

    assert [r.status_code for r in responses] == [200, 200, 409]
    assert responses[2].json()["error"]["code"] == "claim_limit"


async def test_claim_limit_holds_under_concurrent_claims(
    app_client: AsyncClient,
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "teacher_max_active_claims", 2)
    _, tok = await make_user(Role.TEACHER)
    grades = [
        await grade_of(_engine, (await requested(db_session, make_user))[0]) for _ in range(3)
    ]

    responses = await asyncio.gather(
        *(app_client.post(f"/grading/{g.id}/claim", headers=h(tok)) for g in grades)
    )

    assert sorted(r.status_code for r in responses) == [200, 200, 409]
    assert len((await app_client.get("/grading/mine", headers=h(tok))).json()) == 2


async def test_release_returns_to_queue_and_drops_draft(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)
    assert (await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok))).status_code == 200
    async with async_sessionmaker(_engine)() as db:
        await db.execute(
            update(HumanGrade).where(HumanGrade.id == grade.id).values(scores={"tasks": []})
        )
        await db.commit()

    resp = await app_client.post(f"/grading/{grade.id}/release", headers=h(tok))

    assert resp.status_code == 204, resp.text
    stored = await grade_of(_engine, ts)
    assert (stored.status, stored.claimed_by, stored.claimed_at, stored.scores) == (
        "awaiting_grader",
        None,
        None,
        None,
    )
    assert str(grade.id) in {i["grade_id"] for i in await queue(app_client, tok)}


async def test_release_someone_elses_claim_forbidden(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    _, tok_a = await make_user(Role.TEACHER)
    _, tok_b = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)
    assert (
        await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok_a))
    ).status_code == 200

    resp = await app_client.post(f"/grading/{grade.id}/release", headers=h(tok_b))

    assert resp.status_code == 403
    assert (await grade_of(_engine, ts)).status == "claimed"


async def test_release_unclaimed_conflict(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)
    resp = await app_client.post(f"/grading/{grade.id}/release", headers=h(tok))
    assert resp.status_code == 403  # not claimed by the caller (claimed_by is null)


async def test_claim_graded_test_says_graded(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)
    async with async_sessionmaker(_engine)() as db:
        await db.execute(
            update(HumanGrade).where(HumanGrade.id == grade.id).values(status="graded")
        )
        await db.commit()

    resp = await app_client.post(f"/grading/{grade.id}/claim", headers=h(tok))

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "already_graded"
