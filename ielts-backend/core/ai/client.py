"""A thin async client for OpenRouter's OpenAI-compatible chat completions API."""

from typing import Any

import httpx

from core.settings import get_settings


class AIClientError(Exception):
    """The provider call failed. `body` is what came back (parsed JSON or text), if anything."""

    def __init__(self, message: str, body: Any = None) -> None:
        super().__init__(message)
        self.body = body


class OpenRouterClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {api_key}", "X-Title": "IELTS Practice"},
            timeout=timeout,
            transport=transport,
        )

    @classmethod
    def from_settings(cls, transport: httpx.AsyncBaseTransport | None = None) -> "OpenRouterClient":
        settings = get_settings()
        return cls(
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
            timeout=settings.ai_request_timeout_seconds,
            transport=transport,
        )

    async def chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._http.post("chat/completions", json=payload)
        except httpx.HTTPError as exc:
            raise AIClientError(f"request failed: {exc!r}") from exc
        try:
            body: Any = response.json()
        except ValueError:
            body = response.text
        if response.status_code >= 400:
            raise AIClientError(f"HTTP {response.status_code}", body)
        if not isinstance(body, dict):
            raise AIClientError("response is not a JSON object", body)
        if "error" in body:
            raise AIClientError("provider returned an error", body)
        return body

    async def aclose(self) -> None:
        await self._http.aclose()
