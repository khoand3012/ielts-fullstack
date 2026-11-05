import re
from pathlib import Path
from typing import Any

import core.ai.prompts
from core.ai.injection import clean_essay, word_count
from core.ai.messages import TaskInput, build_request
from core.ai.output import ModelOutput
from core.ai.prompts import PROMPT_VERSION, response_schema, system_prompt
from core.settings import Settings, get_settings

PNG = (b"\x89PNG fake", "image/png")


def _task(
    number: int,
    essay: str = "Some words here.",
    *,
    note: str | None = None,
    image: tuple[bytes, str] | None = None,
    prompt: str = "Describe it.",
) -> TaskInput:
    cleaned = clean_essay(essay)
    return TaskInput(
        number=number,
        prompt=prompt,
        min_words=150 if number == 1 else 250,
        essay=cleaned,
        words=word_count(cleaned.text),
        note=note,
        image=image,
    )


def _request(tasks: list[TaskInput], model: str = "m") -> dict[str, Any]:
    return build_request(tasks, model=model, max_tokens=123, temperature=0.0)


def _marker_id(text: str) -> str:
    match = re.search(r'id="([0-9a-f]{16})"', text)
    assert match
    return match.group(1)


def test_system_prompt_is_stable() -> None:
    prompt = system_prompt()
    assert PROMPT_VERSION == "writing-academic-v2"
    assert not re.search(r"\d{4}-\d{2}-\d{2}", prompt)
    assert get_settings().ai_model not in prompt
    a = _request([_task(1, image=PNG), _task(2)])
    b = _request([_task(2, "A different student's essay.", prompt="Other test")], model="other")
    assert a["messages"][0] == b["messages"][0] == {"role": "system", "content": prompt}


def _objects(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if "properties" in node:
            found.append(node)
        for value in node.values():
            found += _objects(value)
    elif isinstance(node, list):
        for value in node:
            found += _objects(value)
    return found


def test_schema_matches_output_model() -> None:
    schema = response_schema()
    assert set(schema["required"]) == set(ModelOutput.model_fields)
    for obj in _objects(schema):
        assert obj["additionalProperties"] is False
        assert set(obj["required"]) == set(obj["properties"])


def test_request_order_and_fields() -> None:
    tasks = [
        _task(1, "Task one essay text", note="Car use falls.", image=PNG),
        _task(2, "Task two essay", prompt="Discuss both views."),
    ]
    request = _request(tasks)
    parts = request["messages"][1]["content"]
    assert [p["type"] for p in parts] == ["text", "image_url", "text", "text", "text"]
    assert "Task 1 prompt" in parts[0]["text"] and "Car use falls." in parts[0]["text"]
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "Task 2 prompt" in parts[2]["text"] and "Discuss both views." in parts[2]["text"]
    t1, t2 = parts[3]["text"], parts[4]["text"]
    assert 'task="1"' in t1 and 'words="4"' in t1 and "Task one essay text" in t1
    assert t1.count(_marker_id(t1)) == 2
    assert _marker_id(t1) != _marker_id(t2)
    again = _request(tasks)["messages"][1]["content"][3]["text"]
    assert _marker_id(again) != _marker_id(t1)
    assert request["model"] == "m"
    assert request["max_tokens"] == 123
    assert request["temperature"] == 0.0
    assert request["provider"] == {"require_parameters": True}
    fmt = request["response_format"]
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["name"] == "writing_assessment"
    assert fmt["json_schema"]["strict"] is True
    assert fmt["json_schema"]["schema"] == response_schema()


def test_request_single_task() -> None:
    parts = _request([_task(2)])["messages"][1]["content"]
    assert [p["type"] for p in parts] == ["text", "text"]
    assert not any("Task 1" in p["text"] for p in parts)


def test_request_without_note_or_image() -> None:
    parts = _request([_task(1), _task(2)])["messages"][1]["content"]
    assert [p["type"] for p in parts] == ["text", "text", "text", "text"]
    assert "Examiner note" not in parts[0]["text"]


def _property_names(schema: Any) -> set[str]:
    if isinstance(schema, dict):
        names = set(schema.get("properties", {}))
        return names.union(*(_property_names(v) for v in schema.values()))
    if isinstance(schema, list):
        return set().union(*(_property_names(v) for v in schema))
    return set()


def test_system_prompt_spells_out_every_schema_field() -> None:
    # Not every provider enforces the JSON schema; the model must learn the shape from the
    # prompt alone.
    prompt = system_prompt()
    missing = sorted(n for n in _property_names(response_schema()) if f'"{n}"' not in prompt)
    assert missing == []


def test_request_ignores_providers() -> None:
    tasks = [_task(2)]
    ignored = build_request(
        tasks, model="m", max_tokens=1, temperature=0.0, ignore_providers=["venice"]
    )
    assert ignored["provider"] == {"require_parameters": True, "ignore": ["venice"]}
    assert _request(tasks)["provider"] == {"require_parameters": True}


def test_settings_defaults_fit_a_reasoning_model() -> None:
    # Measured 2026-10-30: replies use 1.6-4k tokens, over half of it reasoning; Venice
    # accepted the JSON schema but didn't enforce it.
    # required fields and `_env_file` are invisible to pyright (pydantic-settings)
    settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
    assert settings.ai_max_output_tokens == 12000
    assert settings.ai_provider_ignore == ["venice"]


PROMPTS = Path(core.ai.prompts.__file__).parent


def test_v2_schema_requires_kind() -> None:
    item = response_schema()["properties"]["task1"]["properties"]["criteria"]["items"][
        "properties"
    ]["comments"]["items"]
    assert "kind" in item["required"]
    assert item["properties"]["kind"]["enum"] == ["strength", "improvement"]


def test_v1_files_unchanged_and_v2_differs_only_in_comments() -> None:
    v1 = (PROMPTS / "writing_academic_v1.md").read_text(encoding="utf-8")
    v2 = system_prompt()
    assert "strength" not in v1
    assert "`kind`" in v2

    # Band descriptors are byte-identical: from "# Task 1 (Academic)" up to "# What to return".
    def section(s: str) -> str:
        return s[s.index("# Task 1 (Academic)") : s.index("# What to return")]

    assert section(v1) == section(v2)
