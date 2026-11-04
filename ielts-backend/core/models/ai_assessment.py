import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from core.models.enums import AssessmentStatus, check_in


class AIAssessment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One AI-graded Writing session. The row is the grading job's record: no queue."""

    __tablename__ = "ai_assessments"
    __table_args__ = (
        CheckConstraint(check_in("status", AssessmentStatus), name="status"),
        Index("ix_ai_assessments_status", "status"),
    )

    test_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_sessions.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[str] = mapped_column(String(16), default=AssessmentStatus.PROCESSING)
    # Set by the first attempt, so a re-grade can be compared against the prompt and model.
    model: Mapped[str | None] = mapped_column(String(128), default=None)
    prompt_version: Mapped[str | None] = mapped_column(String(64), default=None)
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0)
    # The validated feedback the result endpoint serves (a WritingResult).
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    task1_band: Mapped[Decimal | None] = mapped_column(Numeric(2, 1), default=None)
    task2_band: Mapped[Decimal | None] = mapped_column(Numeric(2, 1), default=None)
    band: Mapped[Decimal | None] = mapped_column(Numeric(2, 1), default=None)
    # One entry per attempt: the full provider response or the error.
    raw_responses: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    error: Mapped[str | None] = mapped_column(Text, default=None)
    signals: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    released_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
