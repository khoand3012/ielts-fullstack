import json
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest

from core.ai.output import TASK_CRITERIA, OutputError, check_quotes, parse_output
from core.models import Criterion
from tests.ai_helpers import completion, model_output


def test_parse_output_ok() -> None:
    output = model_output()
    output["task2"]["criteria"].reverse()
    parsed = parse_output(completion(output), {1, 2})
    assert parsed.task1 is not None and parsed.task2 is not None
    assert [c.criterion for c in parsed.task2.criteria] == list(TASK_CRITERIA[2])
    assert [c.criterion for c in parsed.task1.criteria] == list(TASK_CRITERIA[1])
    assert parsed.task1.criteria[0].band == Decimal("6.0")
    assert parsed.manipulation_attempt is False


def _set_band(band: float) -> Callable[[dict[str, Any]], None]:
    def change(o: dict[str, Any]) -> None:
        o["task2"]["criteria"][0]["band"] = band

    return change


def _set_comments(n: int) -> Callable[[dict[str, Any]], None]:
    def change(o: dict[str, Any]) -> None:
        o["task2"]["criteria"][0]["comments"] = [
            {"comment": "c", "quote": None, "suggestion": None}
        ] * n

    return change


def _no_focus(o: dict[str, Any]) -> None:
    o["focus"] = []


def _long_comment(o: dict[str, Any]) -> None:
    o["task2"]["criteria"][0]["comments"][0]["comment"] = "x" * 401


def _wrong_criterion(o: dict[str, Any]) -> None:
    o["task1"]["criteria"][0]["criterion"] = Criterion.TASK_RESPONSE.value


@pytest.mark.parametrize(
    "change",
    [
        _set_band(6.3),
        _set_band(9.5),
        _set_comments(0),
        _set_comments(4),
        _no_focus,
        _long_comment,
        _wrong_criterion,
    ],
)
def test_parse_output_rejects(change: Callable[[dict[str, Any]], None]) -> None:
    output = model_output()
    change(output)
    with pytest.raises(OutputError):
        parse_output(completion(output), {1, 2})


def test_parse_output_unusable_bodies() -> None:
    good = model_output(tasks=(2,))
    with pytest.raises(OutputError):
        parse_output(completion(good, finish_reason="length"), {2})
    with pytest.raises(OutputError):
        parse_output({"id": "x"}, {2})
    with pytest.raises(OutputError):
        parse_output(completion("not json"), {2})
    fenced = completion("```json\n" + json.dumps(good) + "\n```")
    assert parse_output(fenced, {2}).task2 is not None


def test_parse_output_task_mismatch() -> None:
    with pytest.raises(OutputError):
        parse_output(completion(model_output(tasks=(1, 2))), {2})
    with pytest.raises(OutputError):
        parse_output(completion(model_output(tasks=(1,))), {1, 2})


def _comments(essay: str, quote: str) -> list[tuple[str, str | None, str | None]]:
    parsed = parse_output(completion(model_output(tasks=(2,), quote=quote)), {2})
    assert parsed.task2 is not None
    checked = check_quotes(parsed.task2, essay)
    return [(c.comment, c.quote, c.suggestion) for k in checked.criteria for c in k.comments]


def test_quote_check() -> None:
    essay = "People is more busy nowadays. People's lives change."
    kept = _comments(essay, "people is  more busy")
    assert all(q == "people is  more busy" and s for _, q, s in kept)
    dropped = _comments(essay, "people was busy")
    assert all(q is None and s is None and c for c, q, s in dropped)
    assert all(q is not None for _, q, _ in _comments(essay, "People\u2019s lives"))


def test_quote_check_with_diacritics() -> None:
    kept = _comments("Tôi sống ở Việt Nam từ nhỏ.", "việt nam")
    assert all(q == "việt nam" for _, q, _ in kept)
