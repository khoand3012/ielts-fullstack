"""Builders for model outputs and OpenRouter responses used by the AI grading tests."""

import asyncio
import json
from collections.abc import Collection
from typing import Any

import httpx

from core.ai.output import TASK_CRITERIA


def task_output(
    number: int, band: str = "6.0", quote: str | None = None, kind: str = "improvement"
) -> dict[str, Any]:
    comment = {
        "kind": kind,
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


Response = dict[str, Any] | httpx.Response | Exception | asyncio.Event


class FakeOpenRouter:
    """OpenRouter stand-in: answers each request with the next of `responses`.

    A dict is a 200 JSON body, an httpx.Response is returned as is, an Exception is raised,
    and an asyncio.Event makes the call wait on it before the next response is used.
    """

    def __init__(self, *responses: Response) -> None:
        self.responses: list[Response] = list(responses)
        self.requests: list[dict[str, Any]] = []
        # answers every request once `responses` runs out, if set
        self.default: Response | None = None
        # set once the first request arrives
        self.called = asyncio.Event()

    async def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        self.called.set()
        while True:
            response = self.responses.pop(0) if self.responses else self.default
            if response is None:
                raise AssertionError("FakeOpenRouter has no response left")
            if isinstance(response, asyncio.Event):
                await response.wait()
                continue
            if isinstance(response, Exception):
                raise response
            if isinstance(response, httpx.Response):
                return response
            return httpx.Response(200, json=response)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)
