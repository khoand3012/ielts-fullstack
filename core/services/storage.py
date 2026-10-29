"""R2 (S3-compatible) object storage. Only the endpoint and credentials differ from S3."""

import mimetypes
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

import aioboto3
import botocore.session
from botocore.config import Config

from core.settings import get_settings

# (key, local file, content type) -> uploaded. Injected in tests so R2 is never called.
Uploader = Callable[[str, Path, str], Awaitable[None]]
# key -> (bytes, content type). Injected in tests, like Uploader.
ImageReader = Callable[[str], Awaitable[tuple[bytes, str]]]
# Python 3.11's mimetypes doesn't know .webp, so the chart types are listed explicitly.
_IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


@asynccontextmanager
async def _client() -> AsyncIterator[Any]:
    settings = get_settings()
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    ) as client:
        yield client


async def upload_file(key: str, path: Path, content_type: str) -> None:
    async with _client() as client:
        await client.upload_file(
            str(path), get_settings().r2_bucket, key, ExtraArgs={"ContentType": content_type}
        )


async def read_object(key: str) -> tuple[bytes, str]:
    """An object's bytes and content type (the stored one, else guessed from the key)."""
    async with _client() as client:
        response = await client.get_object(Bucket=get_settings().r2_bucket, Key=key)
        data: bytes = await response["Body"].read()
    guessed = _IMAGE_TYPES.get(Path(key).suffix.lower()) or mimetypes.guess_type(key)[0]
    return data, response.get("ContentType") or guessed or "application/octet-stream"


@lru_cache
def _signer() -> Any:
    """A synchronous client used only to sign URLs. Building a client is slow (botocore loads
    its service model), so it is built once; signing itself is local and takes microseconds."""
    settings = get_settings()
    return botocore.session.get_session().create_client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


async def signed_get_url(key: str) -> str:
    settings = get_settings()
    url: str = _signer().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": key},
        ExpiresIn=settings.signed_url_ttl_seconds,
    )
    return url
