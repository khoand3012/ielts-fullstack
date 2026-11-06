"""Teacher grading: human_grades, with Writing that already waits for a teacher queued

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-06 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from uuid_utils.compat import uuid7

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Submitted Writing that waits for a teacher from now on, with why (human grading spec §4.1):
# requested at submission, AI failed (phase 5 left it `failed`), or AI held it as suspicious.
_WAITING = (
    "SELECT s.id, 'student_request' AS origin FROM test_sessions s "
    "WHERE s.status = 'submitted' AND s.skill = 'writing' AND s.grading_method = 'human' "
    "UNION ALL "
    "SELECT a.test_session_id, CASE a.status WHEN 'failed' THEN 'ai_fallback' "
    "ELSE 'ai_flagged' END FROM ai_assessments a WHERE a.status IN ('failed', 'held')"
)


def upgrade() -> None:
    op.create_table(
        "human_grades",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("test_session_id", sa.Uuid(), nullable=False),
        sa.Column("skill", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("claimed_by", sa.Uuid(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("overall_band", sa.Numeric(2, 1), nullable=True),
        sa.Column("graded_by", sa.Uuid(), nullable=True),
        sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('awaiting_grader', 'claimed', 'graded')",
            name=op.f("ck_human_grades_status"),
        ),
        sa.CheckConstraint(
            "origin IN ('speaking', 'student_request', 'ai_fallback', 'ai_flagged')",
            name=op.f("ck_human_grades_origin"),
        ),
        sa.CheckConstraint(
            "skill IN ('reading', 'listening', 'writing', 'speaking')",
            name=op.f("ck_human_grades_skill"),
        ),
        sa.ForeignKeyConstraint(
            ["test_session_id"],
            ["test_sessions.id"],
            name=op.f("fk_human_grades_test_session_id_test_sessions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["claimed_by"],
            ["users.id"],
            name=op.f("fk_human_grades_claimed_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["graded_by"],
            ["users.id"],
            name=op.f("fk_human_grades_graded_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_human_grades")),
        sa.UniqueConstraint("test_session_id", name=op.f("uq_human_grades_test_session_id")),
    )
    op.create_index("ix_human_grades_status_created_at", "human_grades", ["status", "created_at"])
    op.create_index(
        "ix_human_grades_graded_by_graded_at", "human_grades", ["graded_by", "graded_at"]
    )
    op.create_index("ix_human_grades_claimed_by", "human_grades", ["claimed_by"])

    conn = op.get_bind()
    waiting = conn.execute(sa.text(_WAITING)).all()
    if waiting:
        conn.execute(
            sa.text(
                "INSERT INTO human_grades "
                "(id, test_session_id, skill, status, origin, created_at, updated_at) "
                "VALUES (:id, :sid, 'writing', 'awaiting_grader', :origin, now(), now()) "
                "ON CONFLICT (test_session_id) DO NOTHING"
            ),
            [{"id": uuid7(), "sid": sid, "origin": origin} for sid, origin in waiting],
        )


def downgrade() -> None:
    op.drop_index("ix_human_grades_claimed_by", table_name="human_grades")
    op.drop_index("ix_human_grades_graded_by_graded_at", table_name="human_grades")
    op.drop_index("ix_human_grades_status_created_at", table_name="human_grades")
    op.drop_table("human_grades")
