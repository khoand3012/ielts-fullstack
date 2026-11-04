"""Parsing and checking the model's JSON grade (spec §4.3).

Anything that doesn't fit the schema fails the attempt, which is then retried. Quotes the
student never wrote are dropped instead, so one bad quote never throws a good grade away.
"""

import json
from collections.abc import Collection
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from core.models.enums import Criterion
from core.services.auto_grading import normalize
from core.services.bands import validate_criterion_band

TASK_CRITERIA: dict[int, tuple[Criterion, ...]] = {
    1: (
        Criterion.TASK_ACHIEVEMENT,
        Criterion.COHERENCE_COHESION,
        Criterion.LEXICAL_RESOURCE,
        Criterion.GRAMMATICAL_RANGE_ACCURACY,
    ),
    2: (
        Criterion.TASK_RESPONSE,
        Criterion.COHERENCE_COHESION,
        Criterion.LEXICAL_RESOURCE,
        Criterion.GRAMMATICAL_RANGE_ACCURACY,
    ),
}


class OutputError(ValueError):
    """The model's response can't be used; the attempt failed."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ModelComment(_Strict):
    comment: Annotated[str, Field(min_length=1, max_length=400)]
    quote: Annotated[str, Field(max_length=300)] | None
    suggestion: Annotated[str, Field(max_length=300)] | None


class ModelCriterion(_Strict):
    criterion: Criterion
    band: Decimal
    comments: Annotated[list[ModelComment], Field(min_length=1, max_length=3)]

    @field_validator("band")
    @classmethod
    def _half_band(cls, value: Decimal) -> Decimal:
        return validate_criterion_band(value).quantize(Decimal("0.1"))


class ModelTask(_Strict):
    criteria: list[ModelCriterion]


class ModelOutput(_Strict):
    task1: ModelTask | None
    task2: ModelTask | None
    focus: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=400)]], Field(min_length=1, max_length=3)
    ]
    manipulation_attempt: bool
    manipulation_evidence: Annotated[str, Field(max_length=300)] | None


def _content(body: dict[str, Any]) -> str:
    try:
        choice = body["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise OutputError("response has no message content") from exc
    if choice.get("finish_reason") == "length":
        raise OutputError("response was cut off at the token limit")
    if not isinstance(content, str) or not content.strip():
        raise OutputError("response content is empty")
    text = content.strip()
    # Tolerate one surrounding Markdown code fence.
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.removesuffix("```").strip()
    return text


def _ordered(task: ModelTask, number: int) -> ModelTask:
    expected = TASK_CRITERIA[number]
    by_name = {c.criterion: c for c in task.criteria}
    if len(task.criteria) != len(expected) or set(by_name) != set(expected):
        raise OutputError(
            f"task {number} must have exactly the criteria {[c.value for c in expected]}"
        )
    return task.model_copy(update={"criteria": [by_name[c] for c in expected]})


def parse_output(body: dict[str, Any], tasks: Collection[int]) -> ModelOutput:
    """The validated grade, with each task's criteria in the official order."""
    text = _content(body)
    try:
        output = ModelOutput.model_validate(json.loads(text))
    except (ValueError, ValidationError) as exc:
        raise OutputError(f"response is not a valid grade: {exc}") from exc
    graded: dict[str, ModelTask] = {}
    for number in (1, 2):
        task = output.task1 if number == 1 else output.task2
        if (task is not None) != (number in tasks):
            raise OutputError(f"task {number} was {'not ' if task is None else ''}graded")
        if task is not None:
            graded[f"task{number}"] = _ordered(task, number)
    return output.model_copy(update=graded)


def check_quotes(task: ModelTask, essay: str) -> ModelTask:
    """Drop every quote (with its suggestion) that isn't in the essay; keep the comments."""
    text = normalize(essay)

    def checked(comment: ModelComment) -> ModelComment:
        if comment.quote and comment.quote.strip() and normalize(comment.quote) in text:
            return comment
        return comment.model_copy(update={"quote": None, "suggestion": None})

    return task.model_copy(
        update={
            "criteria": [
                c.model_copy(update={"comments": [checked(x) for x in c.comments]})
                for c in task.criteria
            ]
        }
    )
