"""Submitting a teacher's Writing grade (human grading spec §5.2 step 6, §7)."""

from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.models import HumanGrade, Role, SessionMode, TestSession
from tests.grading_helpers import MakeUser, grade_of, h, requested
from tests.test_ai_grading import ESSAY2

T1 = ("task_achievement", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")
T2 = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")


@pytest.fixture(autouse=True)
def fake_signing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def signed(key: str) -> str:
        return f"https://signed/{key}"

    monkeypatch.setattr("core.services.storage.signed_get_url", signed)


def scores(number: int, bands: tuple[float, ...], feedback: str = "Clear overview.") -> Any:
    names = T1 if number == 1 else T2
    return {
        "number": number,
        "criteria": {n: {"band": b, "comment": "ok"} for n, b in zip(names, bands, strict=True)},
        "feedback": feedback,
    }


BOTH = {"tasks": [scores(1, (6, 6.5, 6, 6.5)), scores(2, (7, 7, 7, 6.5))]}


async def claimed(
    client: AsyncClient, engine: AsyncEngine, db: AsyncSession, make_user: MakeUser, **kw: Any
) -> tuple[HumanGrade, str]:
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db, make_user, **kw)
    grade = await grade_of(engine, ts)
    resp = await client.post(f"/grading/{grade.id}/claim", headers=h(tok))
    assert resp.status_code == 200, resp.text
    return grade, tok


async def stored(engine: AsyncEngine, grade: HumanGrade) -> tuple[HumanGrade, TestSession]:
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        row = await db.get(HumanGrade, grade.id)
        ts = await db.get(TestSession, grade.test_session_id)
        assert row is not None and ts is not None
        return row, ts


async def test_submit_computes_bands(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)

    resp = await app_client.post(f"/grading/{grade.id}/submit", json=BOTH, headers=h(tok))

    assert resp.status_code == 204, resp.text
    row, ts = await stored(_engine, grade)
    # Task 1 mean 6.25, Task 2 mean 6.875: (6.25 + 2 x 6.875) / 3 = 6.67 -> 6.5
    assert (row.status, row.overall_band, ts.band) == ("graded", Decimal("6.5"), Decimal("6.5"))
    assert row.graded_by == row.claimed_by and row.graded_at is not None
    assert row.scores == BOTH


async def test_submit_requires_every_criterion_and_feedback(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)
    url = f"/grading/{grade.id}/submit"

    missing = scores(2, (7, 7, 7, 6.5))
    del missing["criteria"]["lexical_resource"]
    resp = await app_client.post(url, json={"tasks": [BOTH["tasks"][0], missing]}, headers=h(tok))
    assert resp.status_code == 422

    empty = {"tasks": [BOTH["tasks"][0], scores(2, (7, 7, 7, 6.5), feedback="")]}
    assert (await app_client.post(url, json=empty, headers=h(tok))).status_code == 422

    only_two = {"tasks": [BOTH["tasks"][1]]}  # Task 1 was written, so it must be graded
    assert (await app_client.post(url, json=only_two, headers=h(tok))).status_code == 422
    assert (await stored(_engine, grade))[0].status == "claimed"


async def test_submit_blank_task_rules(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    exam, tok = await claimed(
        app_client, _engine, db_session, make_user, essays={2: ESSAY2}, mode=SessionMode.EXAM
    )
    url = f"/grading/{exam.id}/submit"
    # Task 1 is blank, so it has nothing to grade.
    assert (await app_client.post(url, json=BOTH, headers=h(tok))).status_code == 422
    resp = await app_client.post(url, json={"tasks": [BOTH["tasks"][1]]}, headers=h(tok))
    assert resp.status_code == 204, resp.text
    row, ts = await stored(_engine, exam)
    # Task 1 scores 0: (0 + 2 x 6.875) / 3 = 4.58 -> 4.5
    assert (row.overall_band, ts.band) == (Decimal("4.5"), Decimal("4.5"))

    practice, tok = await claimed(app_client, _engine, db_session, make_user, essays={2: ESSAY2})
    resp = await app_client.post(
        f"/grading/{practice.id}/submit", json={"tasks": [BOTH["tasks"][1]]}, headers=h(tok)
    )
    assert resp.status_code == 204, resp.text
    row, ts = await stored(_engine, practice)
    assert (row.status, row.overall_band, ts.band) == ("graded", None, None)


async def test_submit_after_release_is_refused(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)
    # An admin releases the claim (Task 6 adds the endpoint).
    async with async_sessionmaker(_engine)() as db:
        await db.execute(
            update(HumanGrade)
            .where(HumanGrade.id == grade.id)
            .values(status="awaiting_grader", claimed_by=None, claimed_at=None)
        )
        await db.commit()

    resp = await app_client.post(f"/grading/{grade.id}/submit", json=BOTH, headers=h(tok))

    assert resp.status_code == 403
    row, ts = await stored(_engine, grade)
    assert (row.status, row.overall_band, ts.band) == ("awaiting_grader", None, None)


async def test_grade_is_final(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, tok = await claimed(app_client, _engine, db_session, make_user)
    url = f"/grading/{grade.id}/submit"
    assert (await app_client.post(url, json=BOTH, headers=h(tok))).status_code == 204

    changed = {"tasks": [scores(1, (9, 9, 9, 9)), scores(2, (9, 9, 9, 9))]}
    again = await app_client.post(url, json=changed, headers=h(tok))
    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_graded")
    async with async_sessionmaker(_engine)() as db:
        band = await db.scalar(select(HumanGrade.overall_band).where(HumanGrade.id == grade.id))
    assert band == Decimal("6.5")
