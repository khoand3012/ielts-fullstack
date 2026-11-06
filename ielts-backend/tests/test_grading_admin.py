"""Admins release and reassign stuck claims (human grading spec §5.3)."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from core.models import HumanGrade, Role
from core.settings import get_settings
from tests.grading_helpers import MakeUser, grade_of, h, requested

DRAFT = {"tasks": [{"number": 2, "criteria": {"task_response": {"band": 6.0, "comment": None}}}]}


async def claimed(
    client: AsyncClient, engine: AsyncEngine, db: AsyncSession, make_user: MakeUser
) -> tuple[HumanGrade, Any]:
    """A requested grade claimed by a new teacher who has saved a draft; the session too."""
    _, tok = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db, make_user)
    grade = await grade_of(engine, ts)
    assert (await client.post(f"/grading/{grade.id}/claim", headers=h(tok))).status_code == 200
    async with async_sessionmaker(engine)() as s:
        await s.execute(update(HumanGrade).where(HumanGrade.id == grade.id).values(scores=DRAFT))
        await s.commit()
    return grade, ts


async def test_admin_releases_any_claim(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, ts = await claimed(app_client, _engine, db_session, make_user)
    _, admin = await make_user(Role.ADMIN)

    resp = await app_client.post(f"/admin/grading/{grade.id}/release", headers=h(admin))

    assert resp.status_code == 204, resp.text
    row = await grade_of(_engine, ts)
    assert (row.status, row.claimed_by, row.claimed_at, row.scores) == (
        "awaiting_grader",
        None,
        None,
        None,
    )
    again = await app_client.post(f"/admin/grading/{grade.id}/release", headers=h(admin))
    assert again.status_code == 409  # no longer claimed


async def test_admin_release_unknown_grade(app_client: AsyncClient, make_user: MakeUser) -> None:
    _, admin = await make_user(Role.ADMIN)
    url = "/admin/grading/00000000-0000-7000-8000-000000000000/release"
    assert (await app_client.post(url, headers=h(admin))).status_code == 404


async def test_reassign_moves_claim_and_draft(
    app_client: AsyncClient,
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "teacher_max_active_claims", 1)
    grade, ts = await claimed(app_client, _engine, db_session, make_user)
    target, target_tok = await make_user(Role.TEACHER)
    # The target is already at the claim limit; an admin may still hand them this one.
    other, _, _ = await requested(db_session, make_user)
    held = await grade_of(_engine, other)
    claim = await app_client.post(f"/grading/{held.id}/claim", headers=h(target_tok))
    assert claim.status_code == 200
    _, admin = await make_user(Role.ADMIN)

    resp = await app_client.post(
        f"/admin/grading/{grade.id}/reassign",
        json={"teacher_id": str(target.id)},
        headers=h(admin),
    )

    assert resp.status_code == 200, resp.text
    assert (resp.json()["grade_id"], resp.json()["status"]) == (str(grade.id), "claimed")
    row = await grade_of(_engine, ts)
    assert (row.status, row.claimed_by, row.scores) == ("claimed", target.id, DRAFT)
    mine = (await app_client.get("/grading/mine", headers=h(target_tok))).json()
    assert str(grade.id) in {i["grade_id"] for i in mine}


async def test_reassign_target_must_be_teacher_or_admin(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, ts = await claimed(app_client, _engine, db_session, make_user)
    student, _ = await make_user()
    _, admin = await make_user(Role.ADMIN)

    resp = await app_client.post(
        f"/admin/grading/{grade.id}/reassign",
        json={"teacher_id": str(student.id)},
        headers=h(admin),
    )

    assert resp.status_code == 409
    assert (await grade_of(_engine, ts)).claimed_by != student.id


async def test_reassign_target_cannot_be_the_student(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    teacher = await make_user(Role.TEACHER)
    ts, _, _ = await requested(db_session, make_user, student=teacher)
    grade = await grade_of(_engine, ts)
    _, admin = await make_user(Role.ADMIN)

    resp = await app_client.post(
        f"/admin/grading/{grade.id}/reassign",
        json={"teacher_id": str(teacher[0].id)},
        headers=h(admin),
    )

    assert resp.status_code == 403


async def test_reassign_unknown_teacher(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, _ = await claimed(app_client, _engine, db_session, make_user)
    _, admin = await make_user(Role.ADMIN)
    resp = await app_client.post(
        f"/admin/grading/{grade.id}/reassign",
        json={"teacher_id": "00000000-0000-7000-8000-000000000000"},
        headers=h(admin),
    )
    assert resp.status_code == 404


async def test_reassign_awaiting_grade(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    ts, _, _ = await requested(db_session, make_user)
    grade = await grade_of(_engine, ts)
    target, _ = await make_user(Role.TEACHER)
    _, admin = await make_user(Role.ADMIN)

    resp = await app_client.post(
        f"/admin/grading/{grade.id}/reassign",
        json={"teacher_id": str(target.id)},
        headers=h(admin),
    )

    assert resp.status_code == 200, resp.text
    row = await grade_of(_engine, ts)
    assert (row.status, row.claimed_by) == ("claimed", target.id)
    assert row.claimed_at is not None


async def test_teacher_cannot_use_admin_routes(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    grade, _ = await claimed(app_client, _engine, db_session, make_user)
    teacher, tok = await make_user(Role.TEACHER)
    release = await app_client.post(f"/admin/grading/{grade.id}/release", headers=h(tok))
    reassign = await app_client.post(
        f"/admin/grading/{grade.id}/reassign",
        json={"teacher_id": str(teacher.id)},
        headers=h(tok),
    )
    assert (release.status_code, reassign.status_code) == (403, 403)
