import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from core.models import Module, Skill, TestVersion
from core.schemas.content import AnswerKey, StaffContent
from core.services import catalog
from core.services.content import item_index, parse_content
from tests.content_factories import (
    listening_content,
    listening_key,
    listening_staff,
    reading_content,
    reading_key,
    speaking_content,
    writing_content,
    writing_staff,
)


async def _set_answer_key(db: AsyncSession, version_id: uuid.UUID, key: Any) -> Any:
    version = await db.get(TestVersion, version_id)
    assert version is not None
    old = version.answer_key
    version.answer_key = key
    await db.commit()
    return old


@asynccontextmanager
async def broken_answer_key(db: AsyncSession, version_id: uuid.UUID) -> AsyncIterator[None]:
    """Within the block, the version's stored answer key cannot be read (each question must
    map to a list of answers), so marking a session of it throws: the marking-failure path,
    reached with no code replaced. The app never changes a published version; tests do. The
    key is mended on exit, so later sweeps over the shared test database can score it."""
    old = await _set_answer_key(db, version_id, {"1": "not a list of answers"})
    try:
        yield
    finally:
        await _set_answer_key(db, version_id, old)


_DEFAULTS: dict[Skill, tuple[Any, Any, Any]] = {
    Skill.READING: (reading_content, reading_key, dict),
    Skill.LISTENING: (listening_content, listening_key, listening_staff),
    Skill.WRITING: (writing_content, dict, writing_staff),
    Skill.SPEAKING: (speaking_content, dict, dict),
}


async def publish_test(
    db: AsyncSession,
    skill: Skill,
    *,
    slug: str | None = None,
    content: dict[str, Any] | None = None,
    key: AnswerKey | None = None,
    module: Module | None = None,
) -> TestVersion:
    """Save and publish a valid factory test (a new version if `slug` already exists)."""
    make_content, make_key, make_staff = _DEFAULTS[skill]
    version = await catalog.save_draft(
        db,
        slug=slug or f"{skill}-{uuid7()}",
        title=f"{skill} test",
        skill=skill,
        content=parse_content(skill, content or make_content()),
        answer_key=make_key() if key is None else key,
        staff_content=StaffContent.model_validate(make_staff()),
        module=(module or Module.ACADEMIC) if skill == Skill.READING else None,
    )
    return await catalog.publish(db, version.id)


def correct_answers(skill: Skill) -> dict[int, str | list[str]]:
    """Full marks on the factory test of `skill` (reading or listening)."""
    make_content, make_key, _ = _DEFAULTS[skill]
    key = make_key()
    index = item_index(skill, parse_content(skill, make_content()))
    return {q: list(key[q]) if spec.kind == "choice" else key[q][0] for q, spec in index.items()}
