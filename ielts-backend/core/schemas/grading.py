"""Teacher grading: the queue, claims, drafts and grades (human grading spec §5, §9)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import AfterValidator, BaseModel, Field, model_validator

from core.models import Criterion, HumanGradeOrigin, HumanGradeStatus, SessionMode, Skill
from core.schemas.session import Band, WritingResult
from core.services.bands import TASK_CRITERIA, validate_criterion_band


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


CriterionBand = Annotated[Band, AfterValidator(validate_criterion_band)]


class CriterionScore(BaseModel):
    band: CriterionBand
    comment: str | None = Field(default=None, max_length=2000)


class TaskScoresDraft(BaseModel):
    """One task's scores so far; any criterion may still be missing."""

    number: int
    criteria: dict[Criterion, CriterionScore | None]
    feedback: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def _criteria_fit_task(self) -> Self:
        allowed = TASK_CRITERIA.get(self.number)
        if allowed is None:
            raise ValueError(f"Writing has no task {self.number}")
        wrong = [c.value for c in self.criteria if c not in allowed]
        if wrong:
            raise ValueError(f"task {self.number} is not judged on {', '.join(wrong)}")
        return self


class WritingScoresDraft(BaseModel):
    """A teacher's private work in progress, saved as they go (spec §5.2 step 5)."""

    tasks: list[TaskScoresDraft]

    @model_validator(mode="after")
    def _one_entry_per_task(self) -> Self:
        numbers = [t.number for t in self.tasks]
        if len(numbers) != len(set(numbers)):
            raise ValueError("each task may appear once")
        return self


class TaskScores(BaseModel):
    """One task's finished grade: a band on each of the task's four criteria, and feedback."""

    number: int
    criteria: dict[Criterion, CriterionScore]
    feedback: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def _all_criteria(self) -> Self:
        expected = TASK_CRITERIA.get(self.number)
        if expected is None:
            raise ValueError(f"Writing has no task {self.number}")
        if set(self.criteria) != set(expected):
            names = ", ".join(c.value for c in expected)
            raise ValueError(f"task {self.number} needs a band on exactly: {names}")
        return self


class WritingScores(BaseModel):
    """A submitted Writing grade: one entry per written task; blank tasks are left out."""

    tasks: list[TaskScores]

    @model_validator(mode="after")
    def _one_entry_per_task(self) -> Self:
        numbers = [t.number for t in self.tasks]
        if len(numbers) != len(set(numbers)):
            raise ValueError("each task may appear once")
        return self


class GradingTask(BaseModel):
    number: int
    prompt: str
    image_url: str | None
    min_words: int
    # the essay as saved; "" for a blank task
    text: str
    word_count: int


class AIDraft(BaseModel):
    """The held AI grade of a flagged essay, and why it was held."""

    band: Band | None
    result: WritingResult | None
    signals: list[dict[str, Any]]


class GradeDetail(QueueItem):
    mode: SessionMode
    tasks: list[GradingTask]
    draft: WritingScoresDraft | None
    # only for `ai_flagged`
    ai: AIDraft | None


class ReassignRequest(BaseModel):
    teacher_id: uuid.UUID
