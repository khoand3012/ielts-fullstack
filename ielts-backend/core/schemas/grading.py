"""Teacher grading: the queue, claims, drafts and grades (human grading spec §5, §9)."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from core.models import HumanGradeOrigin, HumanGradeStatus, Skill


class QueueItem(BaseModel):
    grade_id: uuid.UUID
    session_id: uuid.UUID
    skill: Skill
    # why a teacher grades it; `ai_fallback` shows as "AI failed"
    origin: HumanGradeOrigin
    status: HumanGradeStatus
    test_title: str
    student_email: str
    submitted_at: datetime
    claimed_at: datetime | None


class QueuePage(BaseModel):
    items: list[QueueItem]
    total: int
