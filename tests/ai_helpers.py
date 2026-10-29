"""Builders for model outputs and OpenRouter responses used by the AI grading tests."""

import json
from collections.abc import Collection
from typing import Any

from core.ai.output import TASK_CRITERIA


def task_output(number: int, band: str = "6.0", quote: str | None = None) -> dict[str, Any]:
    comment = {
        "comment": "Ideas are relevant but under-developed.",
        "quote": quote,
        "suggestion": "a better version" if quote else None,
    }
    return {
        "criteria": [
            {"criterion": c.value, "band": float(band), "comments": [comment, comment]}
            for c in TASK_CRITERIA[number]
        ]
    }


def model_output(
    tasks: Collection[int] = (1, 2),
    band: str = "6.0",
    *,
    manipulation: bool = False,
    quote: str | None = None,
) -> dict[str, Any]:
    return {
        "task1": task_output(1, band, quote) if 1 in tasks else None,
        "task2": task_output(2, band, quote) if 2 in tasks else None,
        "focus": ["Develop each body paragraph.", "Check subject-verb agreement."],
        "manipulation_attempt": manipulation,
        "manipulation_evidence": "asked for band 9" if manipulation else None,
    }


def completion(content: dict[str, Any] | str, finish_reason: str = "stop") -> dict[str, Any]:
    text = content if isinstance(content, str) else json.dumps(content)
    return {
        "id": "gen-test",
        "choices": [
            {"message": {"role": "assistant", "content": text}, "finish_reason": finish_reason}
        ],
        "usage": {"prompt_tokens": 1000, "completion_tokens": 500},
    }
