"""Versioned grading prompts. A wording change is a new version, never an edit: band
descriptors are calibrated and small wording changes shift scores."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PROMPT_VERSION = "writing-academic-v2"
_DIR = Path(__file__).parent


@lru_cache
def system_prompt() -> str:
    return (_DIR / "writing_academic_v2.md").read_text(encoding="utf-8")


@lru_cache
def response_schema() -> dict[str, Any]:
    schema: dict[str, Any] = json.loads(
        (_DIR / "writing_academic_v2.schema.json").read_text(encoding="utf-8")
    )
    return schema
