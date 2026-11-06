"""Migration 0006 queues the Writing that already waits for a teacher (human grading spec §4.1).

Sync on purpose: alembic's env.py runs its own event loop with `asyncio.run`.
"""

import asyncio
import uuid
from typing import Any

import asyncpg  # type: ignore[import-untyped]
import pytest
from alembic.config import Config
from sqlalchemy.engine import make_url

from alembic import command
from core.settings import get_settings


def _alembic() -> Config:
    # No ini file: env.py would reconfigure logging for the whole test run.
    config = Config()
    config.set_main_option("script_location", "alembic")
    return config


def _run(dsn: str, sql: str, *args: Any) -> list[Any]:
    async def go() -> list[Any]:
        conn = await asyncpg.connect(dsn)
        try:
            return list(await conn.fetch(sql, *args))
        finally:
            await conn.close()

    return asyncio.run(go())


def _seed(dsn: str) -> dict[str, uuid.UUID]:
    """A student, a published Writing test and four submitted sessions: one requested a
    teacher, and three were AI graded (failed, held, ready)."""
    user, test, version = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    _run(
        dsn,
        "INSERT INTO users (id, email, password_hash, created_at, updated_at) "
        "VALUES ($1, 'm@t.com', 'x', now(), now())",
        user,
    )
    _run(
        dsn,
        "INSERT INTO tests (id, skill, slug, title, created_at, updated_at) "
        "VALUES ($1, 'writing', 'w', 'W', now(), now())",
        test,
    )
    _run(
        dsn,
        "INSERT INTO test_versions (id, test_id, version, status, content, answer_key, "
        "staff_content, created_at, updated_at) "
        "VALUES ($1, $2, 1, 'published', '{}', '{}', '{}', now(), now())",
        version,
        test,
    )
    sessions = {name: uuid.uuid4() for name in ("human", "failed", "held", "ready")}
    for name, sid in sessions.items():
        _run(
            dsn,
            "INSERT INTO test_sessions (id, user_id, test_version_id, skill, mode, status, "
            "started_at, submitted_at, request_manual_grading, grading_method, created_at, "
            "updated_at) VALUES ($1, $2, $3, 'writing', 'practice', 'submitted', now(), now(), "
            "$4, $5, now(), now())",
            sid,
            user,
            version,
            name == "human",
            "human" if name == "human" else "ai",
        )
        if name != "human":
            _run(
                dsn,
                "INSERT INTO ai_assessments (id, test_session_id, status, attempts, created_at, "
                "updated_at) VALUES ($1, $2, $3, 0, now(), now())",
                uuid.uuid4(),
                sid,
                name,
            )
    return sessions


def _origins(dsn: str) -> dict[uuid.UUID, str]:
    rows = _run(dsn, "SELECT test_session_id, origin, status, skill FROM human_grades")
    assert {(r["status"], r["skill"]) for r in rows} <= {("awaiting_grader", "writing")}
    return {r["test_session_id"]: r["origin"] for r in rows}


def test_backfill_queues_waiting_writing(
    postgres_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    server = make_url(postgres_url)
    name = f"mig_{uuid.uuid4().hex[:12]}"
    plain = server.set(drivername="postgresql")
    _run(plain.render_as_string(hide_password=False), f'CREATE DATABASE "{name}"')
    monkeypatch.setattr(
        get_settings(),
        "database_url",
        server.set(database=name).render_as_string(hide_password=False),
    )
    dsn = plain.set(database=name).render_as_string(hide_password=False)

    command.upgrade(_alembic(), "0005")
    sessions = _seed(dsn)
    command.upgrade(_alembic(), "head")

    expected = {
        sessions["human"]: "student_request",
        sessions["failed"]: "ai_fallback",
        sessions["held"]: "ai_flagged",
    }
    assert _origins(dsn) == expected

    command.downgrade(_alembic(), "0005")
    command.upgrade(_alembic(), "head")
    assert _origins(dsn) == expected
