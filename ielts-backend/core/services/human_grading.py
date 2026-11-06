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

from core.ai.injection import clean_essay, word_count
from core.exceptions import (
    AppError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationAppError,
)
from core.models import (
    AIAssessment,
    Answer,
    HumanGrade,
    HumanGradeOrigin,
    HumanGradeStatus,
    Role,
    SessionMode,
    Skill,
    Test,
    TestSession,
    TestVersion,
    User,
)
from core.schemas.content import WritingContent
from core.schemas.grading import (
    AIDraft,
    GradeDetail,
    GradingTask,
    QueueItem,
    WritingScores,
    WritingScoresDraft,
)
from core.schemas.session import WritingResult
from core.services import catalog, grades, storage
from core.services.bands import TASK_CRITERIA, writing_bands
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


async def _grade(db: AsyncSession, grade_id: uuid.UUID) -> HumanGrade:
    grade = await db.get(HumanGrade, grade_id, populate_existing=True)
    if grade is None:
        raise NotFoundError("grade not found")
    return grade


async def _tasks(db: AsyncSession, ts: TestSession) -> list[GradingTask]:
    version = await db.get(TestVersion, ts.test_version_id)
    assert version is not None
    content = catalog.load_content(Skill.WRITING, version)
    assert isinstance(content, WritingContent)
    answers = {
        a.question_number: a.value
        for a in await db.scalars(select(Answer).where(Answer.test_session_id == ts.id))
    }
    tasks = []
    for task in sorted(content.tasks, key=lambda t: t.number):
        value = answers.get(task.number)
        text = value if isinstance(value, str) and value.strip() else ""
        tasks.append(
            GradingTask(
                number=task.number,
                prompt=task.prompt,
                image_url=await storage.signed_get_url(task.image) if task.image else None,
                min_words=task.min_words,
                text=text,
                word_count=word_count(clean_essay(text).text),
            )
        )
    return tasks


async def _ai_draft(db: AsyncSession, session_id: uuid.UUID) -> AIDraft | None:
    row = await db.scalar(select(AIAssessment).where(AIAssessment.test_session_id == session_id))
    if row is None:
        return None
    result = WritingResult.model_validate(row.result) if row.result is not None else None
    return AIDraft(band=row.band, result=result, signals=list(row.signals))


async def get_detail(db: AsyncSession, user: User, grade_id: uuid.UUID) -> GradeDetail:
    """Everything a teacher needs to grade (spec §5.2 step 3). Open to the claiming teacher
    and to admins; drafts stay private to them."""
    grade = await _grade(db, grade_id)
    if user.role != Role.ADMIN and grade.claimed_by != user.id:
        raise ForbiddenError("this test is not claimed by you")
    item = await get_item(db, grade_id)
    ts = await db.get(TestSession, grade.test_session_id)
    assert ts is not None
    flagged = grade.origin == HumanGradeOrigin.AI_FLAGGED
    return GradeDetail(
        **item.model_dump(),
        mode=SessionMode(ts.mode),
        tasks=await _tasks(db, ts),
        draft=WritingScoresDraft.model_validate(grade.scores) if grade.scores else None,
        ai=await _ai_draft(db, ts.id) if flagged else None,
    )


async def save_draft(
    db: AsyncSession, teacher: User, grade_id: uuid.UUID, draft: WritingScoresDraft
) -> WritingScoresDraft:
    """Replace the caller's draft on their claim. Commits."""
    saved = await db.scalar(
        update(HumanGrade)
        .where(
            HumanGrade.id == grade_id,
            HumanGrade.status == HumanGradeStatus.CLAIMED,
            HumanGrade.claimed_by == teacher.id,
        )
        .values(scores=draft.model_dump(mode="json"))
        .returning(HumanGrade.id)
    )
    if saved is None:
        raise await refusal(db, grade_id, teacher.id)
    await db.commit()
    return draft


async def submit(
    db: AsyncSession,
    teacher: User,
    grade_id: uuid.UUID,
    scores: WritingScores,
    now: datetime | None = None,
) -> None:
    """Submit the caller's grade (spec §5.2 step 6): every written task, none of the blank
    ones. Final; commits."""
    grade = await _grade(db, grade_id)
    if grade.status != HumanGradeStatus.CLAIMED or grade.claimed_by != teacher.id:
        raise await refusal(db, grade_id, teacher.id)
    ts = await db.get(TestSession, grade.test_session_id)
    assert ts is not None
    written = {t.number for t in await _tasks(db, ts) if t.text}
    submitted = {t.number: t for t in scores.tasks}
    if set(submitted) != written:
        raise ValidationAppError(
            f"grade exactly the written tasks: {sorted(written) or 'none'}; blank tasks are "
            "left out"
        )
    mode = SessionMode(ts.mode)
    bands = writing_bands(
        mode,
        {
            n: [submitted[n].criteria[c].band for c in TASK_CRITERIA[n]] if n in submitted else None
            for n in TASK_CRITERIA
        },
    )
    moved = await grades.record_human_grade(
        db, grade_id, teacher.id, scores.model_dump(mode="json"), bands, _now(now)
    )
    if moved is None:  # released or reassigned since we looked
        raise await refusal(db, grade_id, teacher.id)
    await db.commit()
    log.info(
        "human_grading_graded",
        grade_id=str(grade_id),
        by=str(teacher.id),
        band=str(bands.overall) if bands.overall is not None else None,
    )


async def admin_release(db: AsyncSession, admin: User, grade_id: uuid.UUID) -> None:
    """Return anyone's claim to the queue; the draft is discarded (spec §5.3). 409 unless
    the grade is claimed. Commits."""
    released = await db.scalar(
        update(HumanGrade)
        .where(HumanGrade.id == grade_id, HumanGrade.status == HumanGradeStatus.CLAIMED)
        .values(
            status=HumanGradeStatus.AWAITING_GRADER, claimed_by=None, claimed_at=None, scores=None
        )
        .returning(HumanGrade.id)
    )
    if released is None:
        await _grade(db, grade_id)
        raise ConflictError("this test is not claimed")
    await db.commit()
    log.info("human_grading_released", grade_id=str(grade_id), by=str(admin.id))


async def reassign(
    db: AsyncSession,
    admin: User,
    grade_id: uuid.UUID,
    teacher_id: uuid.UUID,
    now: datetime | None = None,
) -> QueueItem:
    """Give an ungraded test to `teacher_id`, claimed or not; any draft goes with it, and the
    claim limit does not apply (spec §5.3). 404 unknown grade or user, 409 the user is not a
    teacher or admin or the test is graded, 403 the user is the test's student. Commits."""
    grade = await _grade(db, grade_id)
    target = await db.get(User, teacher_id)
    if target is None:
        raise NotFoundError("user not found")
    if target.role not in (Role.TEACHER, Role.ADMIN):
        raise ConflictError("only a teacher or an admin can be given a test to grade")
    owner = await db.scalar(
        select(TestSession.user_id).where(TestSession.id == grade.test_session_id)
    )
    if owner == teacher_id:
        raise ForbiddenError("a student cannot grade their own test")
    moved = await db.scalar(
        update(HumanGrade)
        .where(HumanGrade.id == grade_id, HumanGrade.status != HumanGradeStatus.GRADED)
        .values(status=HumanGradeStatus.CLAIMED, claimed_by=teacher_id, claimed_at=_now(now))
        .returning(HumanGrade.id)
    )
    if moved is None:
        raise ConflictError("this test is already graded")
    await db.commit()
    log.info(
        "human_grading_reassigned",
        grade_id=str(grade_id),
        by=str(admin.id),
        to=str(teacher_id),
        previous=str(grade.claimed_by) if grade.claimed_by else None,
    )
    return await get_item(db, grade_id)
