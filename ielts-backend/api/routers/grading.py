import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from api.deps import DbSession, TeacherUser
from core.models import Skill
from core.schemas.grading import QueueItem, QueuePage
from core.services import human_grading

router = APIRouter(prefix="/grading", tags=["grading"])

# The literal paths come before `/{grade_id}` so they are never parsed as an id.


@router.get("/queue", response_model=QueuePage, operation_id="grading_queue")
async def queue(
    _: TeacherUser,
    session: DbSession,
    skill: Skill | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> QueuePage:
    items, total = await human_grading.list_queue(session, skill=skill, limit=limit, offset=offset)
    return QueuePage(items=items, total=total)


@router.get("/mine", response_model=list[QueueItem], operation_id="grading_mine")
async def mine(teacher: TeacherUser, session: DbSession) -> list[QueueItem]:
    return await human_grading.list_mine(session, teacher)


@router.post("/{grade_id}/claim", response_model=QueueItem, operation_id="grading_claim")
async def claim(grade_id: uuid.UUID, teacher: TeacherUser, session: DbSession) -> QueueItem:
    return await human_grading.claim(session, teacher, grade_id)


@router.post(
    "/{grade_id}/release",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="grading_release",
)
async def release(grade_id: uuid.UUID, teacher: TeacherUser, session: DbSession) -> None:
    await human_grading.release(session, teacher, grade_id)
