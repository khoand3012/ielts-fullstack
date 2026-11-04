import json

import httpx
import pytest

from core.ai.client import AIClientError, OpenRouterClient

PAYLOAD = {"model": "m", "messages": [{"role": "user", "content": "hi"}]}
COMPLETION = {"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}


def _client(handler: httpx.MockTransport) -> OpenRouterClient:
    return OpenRouterClient(
        base_url="https://or.test/api/v1", api_key="sk-test", timeout=5, transport=handler
    )


async def test_chat_posts_payload() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=COMPLETION)

    client = _client(httpx.MockTransport(handle))
    try:
        assert await client.chat(PAYLOAD) == COMPLETION
    finally:
        await client.aclose()
    [request] = seen
    assert str(request.url) == "https://or.test/api/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer sk-test"
    assert json.loads(request.content) == PAYLOAD


@pytest.mark.parametrize(
    ("response", "body"),
    [
        (httpx.Response(500, json={"error": {"message": "boom"}}), {"error": {"message": "boom"}}),
        (httpx.Response(200, json={"error": {"message": "x"}}), {"error": {"message": "x"}}),
        (httpx.Response(200, text="<html>"), "<html>"),
    ],
)
async def test_chat_error_bodies(response: httpx.Response, body: object) -> None:
    client = _client(httpx.MockTransport(lambda _: response))
    try:
        with pytest.raises(AIClientError) as caught:
            await client.chat(PAYLOAD)
    finally:
        await client.aclose()
    assert caught.value.body == body


async def test_chat_timeout_is_a_client_error() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    client = _client(httpx.MockTransport(handle))
    try:
        with pytest.raises(AIClientError) as caught:
            await client.chat(PAYLOAD)
    finally:
        await client.aclose()
    assert caught.value.body is None
