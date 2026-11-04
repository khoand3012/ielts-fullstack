"""AI Writing grading: ai_assessments, with a row for every AI session already submitted

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-29 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from uuid_utils.compat import uuid7

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_assessments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("test_session_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("prompt_version", sa.String(length=64), nullable=True),
        sa.Column("attempts", sa.SmallInteger(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("task1_band", sa.Numeric(2, 1), nullable=True),
        sa.Column("task2_band", sa.Numeric(2, 1), nullable=True),
        sa.Column("band", sa.Numeric(2, 1), nullable=True),
        sa.Column(
            "raw_responses",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "signals",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by", sa.Uuid(), nullable=True),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('processing', 'ready', 'held', 'failed')",
            name=op.f("ck_ai_assessments_status"),
        ),
        sa.ForeignKeyConstraint(
            ["test_session_id"],
            ["test_sessions.id"],
            name=op.f("fk_ai_assessments_test_session_id_test_sessions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["released_by"],
            ["users.id"],
            name=op.f("fk_ai_assessments_released_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_assessments")),
        sa.UniqueConstraint("test_session_id", name=op.f("uq_ai_assessments_test_session_id")),
    )
    op.create_index("ix_ai_assessments_status", "ai_assessments", ["status"])

    # Writing sessions submitted before this phase get a job, which the startup resume grades.
    conn = op.get_bind()
    session_ids = conn.scalars(
        sa.text(
            "SELECT s.id FROM test_sessions s "
            "LEFT JOIN ai_assessments a ON a.test_session_id = s.id "
            "WHERE s.status = 'submitted' AND s.grading_method = 'ai' AND a.id IS NULL"
        )
    ).all()
    if session_ids:
        conn.execute(
            sa.text(
                "INSERT INTO ai_assessments "
                "(id, test_session_id, status, attempts, created_at, updated_at) "
                "VALUES (:id, :sid, 'processing', 0, now(), now())"
            ),
            [{"id": uuid7(), "sid": sid} for sid in session_ids],
        )


def downgrade() -> None:
    op.drop_index("ix_ai_assessments_status", table_name="ai_assessments")
    op.drop_table("ai_assessments")
