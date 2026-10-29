"""Building the OpenRouter request for one grading call (spec §4.2, §4.7).

Order, most-shared first, so the provider's prefix cache covers as much as possible: the
system prompt (identical on every call), then each task's prompt, examiner note and chart
(identical for everyone taking the same test version), then the essays.
"""

import base64
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from core.ai.injection import CleanEssay, new_marker_id, wrap_essay
from core.ai.prompts import response_schema, system_prompt


@dataclass(frozen=True)
class TaskInput:
    number: int
    prompt: str
    min_words: int
    essay: CleanEssay
    words: int
    note: str | None
    # Task 1's chart: (bytes, content type)
    image: tuple[bytes, str] | None


def _prompt_text(task: TaskInput) -> str:
    text = f"Task {task.number} prompt (minimum {task.min_words} words):\n{task.prompt}"
    if task.note:
        text += f"\n\nExaminer note (trusted, staff-written): {task.note}"
    return text


def build_request(
    tasks: Sequence[TaskInput], *, model: str, max_tokens: int, temperature: float
) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []
    for task in tasks:
        parts.append({"type": "text", "text": _prompt_text(task)})
        if task.image is not None:
            data, content_type = task.image
            url = f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"
            parts.append({"type": "image_url", "image_url": {"url": url}})
    for task in tasks:
        essay = wrap_essay(task.number, task.essay.text, task.words, new_marker_id())
        parts.append({"type": "text", "text": essay})
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt()},
            {"role": "user", "content": parts},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "writing_assessment",
                "strict": True,
                "schema": response_schema(),
            },
        },
        # Only route to providers that honour every parameter, the JSON schema above included.
        "provider": {"require_parameters": True},
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
