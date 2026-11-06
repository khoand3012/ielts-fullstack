import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from core.models.enums import HumanGradeOrigin, HumanGradeStatus, Skill, check_in


class HumanGrade(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One teacher-graded session: its queue entry, its claim, the draft and the grade."""

    __tablename__ = "human_grades"
    __table_args__ = (
        CheckConstraint(check_in("status", HumanGradeStatus), name="status"),
        CheckConstraint(check_in("origin", HumanGradeOrigin), name="origin"),
        CheckConstraint(check_in("skill", Skill), name="skill"),
        Index("ix_human_grades_status_created_at", "status", "created_at"),
        Index("ix_human_grades_graded_by_graded_at", "graded_by", "graded_at"),
        Index("ix_human_grades_claimed_by", "claimed_by"),
    )

    test_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_sessions.id", ondelete="CASCADE"), unique=True
    )
    skill: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default=HumanGradeStatus.AWAITING_GRADER)
    origin: Mapped[str] = mapped_column(String(16))
    claimed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # The draft while claimed, the final scores once graded (a per-skill schema).
    scores: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    overall_band: Mapped[Decimal | None] = mapped_column(Numeric(2, 1), default=None)
    graded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
