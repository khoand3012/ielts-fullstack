"""Teacher grading (human grading spec §5): one shared queue, oldest submission first; a claim
is an atomic conditional update, so no two teachers grade the same test.

Sessions enter the queue through `grades.enqueue_human`; the grade itself is written by
`grades.record_human_grade`.
"""

import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import ColumnElement, Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import AppError, ConflictError, ForbiddenError, NotFoundError
from core.models import (
    HumanGrade,
    HumanGradeOrigin,
    HumanGradeStatus,
    Skill,
    Test,
    TestSession,
    TestVersion,
    User,
)
from core.schemas.grading import QueueItem
from core.settings import get_settings

log = structlog.get_logger()


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


def _items() -> Select[tuple[HumanGrade, TestSession, str, str]]:
    return (
        select(HumanGrade, TestSession, Test.title, User.email)
        .join(TestSession, TestSession.id == HumanGrade.test_session_id)
        .join(TestVersion, TestVersion.id == TestSession.test_version_id)
        .join(Test, Test.id == TestVersion.test_id)
        .join(User, User.id == TestSession.user_id)
    )


def _item(grade: HumanGrade, ts: TestSession, title: str, email: str) -> QueueItem:
    assert ts.submitted_at is not None  # only submitted sessions are queued
    return QueueItem(
        grade_id=grade.id,
        session_id=ts.id,
        skill=Skill(grade.skill),
        origin=HumanGradeOrigin(grade.origin),
        status=HumanGradeStatus(grade.status),
        test_title=title,
        student_email=email,
        submitted_at=ts.submitted_at,
        claimed_at=grade.claimed_at,
    )


Rows = Select[tuple[HumanGrade, TestSession, str, str]]


async def _list(db: AsyncSession, stmt: Rows) -> list[QueueItem]:
    rows = await db.execute(stmt.execution_options(populate_existing=True))
    return [_item(*row) for row in rows.tuples()]


async def get_item(db: AsyncSession, grade_id: uuid.UUID) -> QueueItem:
    items = await _list(db, _items().where(HumanGrade.id == grade_id))
    if not items:
        raise NotFoundError("grade not found")
    return items[0]


async def list_queue(
    db: AsyncSession, *, skill: Skill | None, limit: int, offset: int
) -> tuple[list[QueueItem], int]:
    """Unclaimed grades, oldest submission first: a test handed over after AI failure keeps
    the place its submission time gives it (spec §4.1)."""
    where: list[ColumnElement[bool]] = [HumanGrade.status == HumanGradeStatus.AWAITING_GRADER]
    if skill is not None:
        where.append(HumanGrade.skill == skill)
    total = await db.scalar(select(func.count()).select_from(HumanGrade).where(*where))
    page = await _list(
        db,
        _items()
        .where(*where)
        .order_by(TestSession.submitted_at, HumanGrade.id)
        .limit(limit)
        .offset(offset),
    )
    return page, total or 0


async def list_mine(db: AsyncSession, teacher: User) -> list[QueueItem]:
    """The caller's active claims, oldest claim first."""
    return await _list(
        db,
        _items()
        .where(HumanGrade.status == HumanGradeStatus.CLAIMED, HumanGrade.claimed_by == teacher.id)
        .order_by(HumanGrade.claimed_at, HumanGrade.id),
    )


async def refusal(db: AsyncSession, grade_id: uuid.UUID, user_id: uuid.UUID) -> AppError:
    """Why a teacher's conditional update on their claim moved nothing: unknown grade, already
    graded, not their claim (including one released or reassigned since), else not claimed."""
    row = (
        await db.execute(
            select(HumanGrade.status, HumanGrade.claimed_by).where(HumanGrade.id == grade_id)
        )
    ).first()
    if row is None:
        return NotFoundError("grade not found")
    status, claimed_by = row
    if status == HumanGradeStatus.GRADED:
        return ConflictError("this test is already graded")
    if claimed_by != user_id:
        return ForbiddenError("this test is not claimed by you")
    return ConflictError("this test is not claimed")


async def claim(
    db: AsyncSession, teacher: User, grade_id: uuid.UUID, now: datetime | None = None
) -> QueueItem:
    """Claim an unclaimed grade. 404 unknown, 403 the caller's own test, 409 already claimed
    or the caller already holds `teacher_max_active_claims`. Commits."""
    # One claim at a time per teacher, so concurrent claims cannot pass the limit together.
    await db.execute(select(User.id).where(User.id == teacher.id).with_for_update())
    owner = await db.scalar(
        select(TestSession.user_id)
        .join(HumanGrade, HumanGrade.test_session_id == TestSession.id)
        .where(HumanGrade.id == grade_id)
    )
    if owner is None:
        raise NotFoundError("grade not found")
    if owner == teacher.id:
        raise ForbiddenError("you cannot grade your own test")
    active = await db.scalar(
        select(func.count())
        .select_from(HumanGrade)
        .where(HumanGrade.status == HumanGradeStatus.CLAIMED, HumanGrade.claimed_by == teacher.id)
    )
    limit = get_settings().teacher_max_active_claims
    if (active or 0) >= limit:
        raise ConflictError(f"you already hold {limit} claims; grade or release one first")
    claimed = await db.scalar(
        update(HumanGrade)
        .where(HumanGrade.id == grade_id, HumanGrade.status == HumanGradeStatus.AWAITING_GRADER)
        .values(status=HumanGradeStatus.CLAIMED, claimed_by=teacher.id, claimed_at=_now(now))
        .returning(HumanGrade.id)
    )
    if claimed is None:
        raise ConflictError("this test is already claimed")
    await db.commit()
    log.info("human_grading_claimed", grade_id=str(grade_id), by=str(teacher.id))
    return await get_item(db, grade_id)


async def release(db: AsyncSession, teacher: User, grade_id: uuid.UUID) -> None:
    """Give the caller's claim back to the queue; the draft is discarded (spec §5.2 step 7).
    Commits."""
    released = await db.scalar(
        update(HumanGrade)
        .where(
            HumanGrade.id == grade_id,
            HumanGrade.status == HumanGradeStatus.CLAIMED,
            HumanGrade.claimed_by == teacher.id,
        )
        .values(
            status=HumanGradeStatus.AWAITING_GRADER, claimed_by=None, claimed_at=None, scores=None
        )
        .returning(HumanGrade.id)
    )
    if released is None:
        raise await refusal(db, grade_id, teacher.id)
    await db.commit()
    log.info("human_grading_released", grade_id=str(grade_id), by=str(teacher.id))
