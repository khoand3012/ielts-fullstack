import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, PlainSerializer

from core.models import (
    Criterion,
    GradingMethod,
    Module,
    SessionMode,
    SessionStatus,
    Skill,
    SubmitReason,
)

# Bands are Decimal in Python and a plain JSON number (7.0) in the API; halves are exact floats.
Band = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class AnswerInput(BaseModel):
    question: int
    # option keys for multiple choice, one key for matching, text otherwise; null clears
    value: str | list[str] | None


class SessionStartRequest(BaseModel):
    test_id: uuid.UUID
    mode: SessionMode


class SessionUpdateRequest(BaseModel):
    request_manual_grading: bool


class AnswersRequest(BaseModel):
    answers: list[AnswerInput] = Field(min_length=1, max_length=100)


class AnswersResponse(BaseModel):
    answers: dict[int, Any]


class SessionRead(BaseModel):
    id: uuid.UUID
    test_id: uuid.UUID
    test_version_id: uuid.UUID
    title: str
    skill: Skill
    mode: SessionMode
    status: SessionStatus
    started_at: datetime
    deadline: datetime | None
    submitted_at: datetime | None
    submit_reason: SubmitReason | None
    request_manual_grading: bool
    grading_method: GradingMethod | None
    # Reading only
    module: Module | None
    # Reading/Listening, once scored; a partial practice attempt has a mark but no band
    raw_score: int | None
    # Reading/Listening once scored, Writing once AI-graded; null for a practice attempt
    # with a blank task
    band: Band | None
    server_time: datetime


class SessionDetail(SessionRead):
    # student-visible content only, with asset keys replaced by signed URLs
    content: dict[str, Any]
    answers: dict[int, Any]


class SessionListResponse(BaseModel):
    items: list[SessionRead]
    total: int


class ResultQuestion(BaseModel):
    number: int  # the item key (its first question number)
    numbers: list[int]
    kind: Literal["text", "single_choice", "choice"]
    answer: str | list[str] | None  # as the student saved it
    accepted: list[str]  # text: any of these; choice: this exact set
    correct_choices: list[str] | None  # choice only: the student's picks that are right
    marks: int
    max_marks: int


_PLAIN_TEXT = "plain text — render as text, never HTML or Markdown"


class WritingComment(BaseModel):
    comment: str = Field(description=f"What is right or wrong and why; {_PLAIN_TEXT}")
    quote: str | None = Field(description=f"The student's own words, exactly; {_PLAIN_TEXT}")
    suggestion: str | None = Field(description=f"A better version of the quote; {_PLAIN_TEXT}")


class WritingCriterion(BaseModel):
    criterion: Criterion
    band: Band
    # empty for a blank exam task, which scores 0
    comments: list[WritingComment]


class WritingTask(BaseModel):
    number: int
    # null for a blank practice task, which isn't graded
    band: Band | None
    word_count: int
    criteria: list[WritingCriterion]


class WritingResult(BaseModel):
    """The AI's feedback on a Writing session, as stored on the assessment and served."""

    tasks: list[WritingTask]
    focus: list[str] = Field(
        description=f"The changes most likely to lift the band, most important first; {_PLAIN_TEXT}"
    )


class SessionResult(BaseModel):
    session_id: uuid.UUID
    test_id: uuid.UUID
    title: str
    skill: Skill
    module: Module | None
    mode: SessionMode
    submit_reason: SubmitReason | None
    grading_method: GradingMethod | None
    started_at: datetime
    submitted_at: datetime | None
    time_spent_seconds: int
    status: Literal["graded", "being_graded"]
    # null unless graded; band is also null for a partial practice attempt
    raw_score: int | None
    max_score: int | None
    band: Band | None
    answered: int | None
    questions: list[ResultQuestion] | None
    # AI-graded Writing, once graded; null otherwise
    writing: WritingResult | None = None
