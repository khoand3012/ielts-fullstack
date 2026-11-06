"""Reviewing AI grades held for suspected manipulation (spec §7.5), until the teacher queue
takes them over in phase 8."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import ForbiddenError, NotFoundError
from core.models import AIAssessment, Answer, AssessmentStatus, Role, TestSession, User
from core.services import grades

log = structlog.get_logger()


@dataclass(frozen=True)
class HeldItem:
    assessment_id: uuid.UUID
    session_id: uuid.UUID
    email: str
    submitted_at: datetime
    signals: list[dict[str, Any]]
    band: Decimal | None
    task1_band: Decimal | None
    task2_band: Decimal | None


def _held() -> Select[tuple[AIAssessment, TestSession, User]]:
    return (
        select(AIAssessment, TestSession, User)
        .join(TestSession, TestSession.id == AIAssessment.test_session_id)
        .join(User, User.id == TestSession.user_id)
        .where(AIAssessment.status == AssessmentStatus.HELD)
    )


def _item(row: AIAssessment, ts: TestSession, user: User) -> HeldItem:
    assert ts.submitted_at is not None
    return HeldItem(
        assessment_id=row.id,
        session_id=ts.id,
        email=user.email,
        submitted_at=ts.submitted_at,
        signals=row.signals,
        band=row.band,
        task1_band=row.task1_band,
        task2_band=row.task2_band,
    )


async def list_held(db: AsyncSession) -> list[HeldItem]:
    """Every held assessment, oldest first."""
    result = await db.execute(_held().order_by(AIAssessment.completed_at, AIAssessment.id))
    return [_item(*r) for r in result.tuples()]


async def get_held(db: AsyncSession, assessment_id: uuid.UUID) -> tuple[HeldItem, dict[int, str]]:
    """A held assessment and the essays as the student wrote them, by task."""
    found = (await db.execute(_held().where(AIAssessment.id == assessment_id))).tuples().first()
    if found is None:
        raise NotFoundError("no held assessment with that id")
    item = _item(*found)
    answers = await db.scalars(
        select(Answer)
        .where(Answer.test_session_id == item.session_id)
        .order_by(Answer.question_number)
    )
    return item, {a.question_number: a.value for a in answers if isinstance(a.value, str)}


async def release_held(
    db: AsyncSession, assessment_id: uuid.UUID, admin_email: str, now: datetime | None = None
) -> None:
    """A false alarm: the AI grade stands. `held → ready`, and the session gets its band."""
    admin = await db.scalar(select(User).where(User.email == admin_email))
    if admin is None:
        raise NotFoundError("user not found")
    if admin.role != Role.ADMIN:
        raise ForbiddenError("only admins can release held essays")
    session_id = await grades.record_ai_outcome(
        db,
        AIAssessment.id == assessment_id,
        expected=AssessmentStatus.HELD,
        values={
            "status": AssessmentStatus.READY,
            "released_by": admin.id,
            "released_at": now or datetime.now(UTC),
        },
    )
    if session_id is None:
        raise NotFoundError("no held assessment with that id")
    await db.commit()
    log.info(
        "ai_grading_released",
        assessment_id=str(assessment_id),
        session_id=str(session_id),
        by=str(admin.id),
    )
