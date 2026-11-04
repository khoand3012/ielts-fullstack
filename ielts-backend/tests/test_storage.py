import time
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

import pytest

from core.services import storage
from core.services.storage import signed_get_url
from core.settings import get_settings


async def test_signed_get_url_is_signed_for_the_key() -> None:
    url = await signed_get_url("tests/x/a.mp3")
    assert "tests/x/a.mp3" in url
    assert "X-Amz-Signature=" in url


def test_signed_urls_outlive_the_longest_exam() -> None:
    settings = get_settings()
    longest = max(
        settings.reading_time_limit_minutes,
        settings.listening_time_limit_minutes,
        settings.writing_time_limit_minutes,
        settings.speaking_time_limit_minutes,
    )
    assert settings.signed_url_ttl_seconds >= longest * 60 + settings.session_grace_seconds


async def test_signing_many_keys_does_not_stall_the_event_loop() -> None:
    await signed_get_url("tests/warmup.mp3")
    start = time.perf_counter()
    for n in range(20):
        await signed_get_url(f"tests/x/{n}.mp3")
    assert time.perf_counter() - start < 0.5


class _Body:
    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


class _FakeS3:
    def __init__(self, response: dict[str, object]) -> None:
        self.response = response
        self.calls: list[dict[str, object]] = []

    async def get_object(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        return self.response


def _fake_client(s3: _FakeS3) -> Callable[[], AbstractAsyncContextManager[_FakeS3]]:
    @asynccontextmanager
    async def client() -> AsyncIterator[_FakeS3]:
        yield s3

    return client


async def test_read_object_returns_bytes_and_type(monkeypatch: pytest.MonkeyPatch) -> None:
    s3 = _FakeS3({"Body": _Body(b"png"), "ContentType": "image/png"})
    monkeypatch.setattr(storage, "_client", _fake_client(s3))
    assert await storage.read_object("tests/x/chart.png") == (b"png", "image/png")
    assert s3.calls == [{"Bucket": get_settings().r2_bucket, "Key": "tests/x/chart.png"}]

    untyped = _FakeS3({"Body": _Body(b"w")})
    monkeypatch.setattr(storage, "_client", _fake_client(untyped))
    assert await storage.read_object("tests/x/chart.webp") == (b"w", "image/webp")


async def test_server_calls_use_the_internal_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    assert storage._server_endpoint() == settings.r2_endpoint_url
    monkeypatch.setattr(settings, "r2_internal_endpoint_url", "http://minio:9000")
    assert storage._server_endpoint() == "http://minio:9000"
    # Browsers can't reach the internal address: signed URLs keep the public one.
    assert (await signed_get_url("tests/x/a.png")).startswith(settings.r2_endpoint_url)
