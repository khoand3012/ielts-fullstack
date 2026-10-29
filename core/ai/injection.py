"""Prompt-injection defences for student essays (spec §4.7).

The essay is the only untrusted text sent to the model. It is cleaned before sending
(invisible format characters removed, fake essay markers neutralized), wrapped between
markers with a random id per call, and scanned for signs of an attempt to steer the grade.
Any signal holds the essay for human review instead of showing its grade.
"""

import re
import secrets
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from core.models.enums import Criterion, SignalSource

# More removed format characters than this is hidden text, not a stray zero-width space.
_HIDDEN_TEXT_THRESHOLD = 3
_DETAIL_CHARS = 100
_IMPLAUSIBLE_BAND = Decimal("7.0")

_MARKER = re.compile(r"<(\s*/?\s*essay)", re.IGNORECASE)
_LOOKALIKE_ANGLE = "‹"

# Narrow on purpose: an honest essay about rules, AI or exams must not match. Matched against
# NFC text, case-insensitively.
PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE | re.MULTILINE)
    for p in (
        r"\bignore\s+(?:all\s+)?(?:the\s+|any\s+|your\s+)?(?:previous|prior|above|earlier)\s+"
        r"(?:instructions|rules|prompts?)",
        r"\byou\s+are\s+now\s+(?:an?\s+|the\s+)?(?:\w+\s+){0,2}"
        r"(?:examiner|grader|assistant|ai|model|chatbot)\b",
        r"^\s*(?:system|assistant|developer)\s*:",
        r"\bgive\s+(?:me|it|this(?:\s+essay)?|the\s+essay|my\s+essay)\s+(?:a\s+)?band\s*9",
        r"\bscore\s+(?:this|every|each|all)\b[^.\n]{0,40}\b9\b",
        r"\{\s*\"(?:band|task1|task2|criteria|focus|manipulation_attempt)\"\s*:",
        r"\bexaminer(?:'s)?\s+note\s*:",
        r"\b(?:print|repeat|reveal|show|output)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?"
        r"(?:instructions|prompt|rubric)",
        r"\bbỏ\s+qua\s+(?:mọi|tất\s+cả|các)?\s*(?:hướng\s+dẫn|chỉ\s+dẫn|yêu\s+cầu)",
        r"\bcho\s+(?:bài\s+(?:viết\s+)?này\s+|tôi\s+)?(?:band|điểm)\s*9",
        r"\bbạn\s+(?:bây\s+giờ|giờ)\s+là\b",
    )
)


@dataclass(frozen=True)
class CleanEssay:
    text: str
    removed_format_chars: int
    neutralized_markers: int


@dataclass(frozen=True)
class Signal:
    source: SignalSource
    task: int | None
    detail: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "detail", self.detail[:_DETAIL_CHARS])

    def to_json(self) -> dict[str, Any]:
        return {"source": self.source.value, "task": self.task, "detail": self.detail}


def clean_essay(text: str) -> CleanEssay:
    """The copy of an essay sent to the model. The stored answer is never changed."""
    kept = [c for c in text if unicodedata.category(c) != "Cf"]
    # A look-alike angle quote, so "</essay" can no longer close our marker.
    cleaned, markers = _MARKER.subn(_LOOKALIKE_ANGLE + "\\1", "".join(kept))
    return CleanEssay(cleaned, len(text) - len(kept), markers)


def word_count(text: str) -> int:
    return len(text.split())


def new_marker_id() -> str:
    return secrets.token_hex(8)


def wrap_essay(task: int, text: str, words: int, marker_id: str) -> str:
    return (
        f'<essay task="{task}" words="{words}" id="{marker_id}">\n{text}\n</essay id="{marker_id}">'
    )


def input_signals(task: int, essay: CleanEssay) -> list[Signal]:
    """Signs of manipulation found in the essay itself, before any model call."""
    text = unicodedata.normalize("NFC", essay.text)
    signals = [
        Signal(SignalSource.PATTERN, task, match.group(0))
        for pattern in PATTERNS
        if (match := pattern.search(text))
    ]
    if essay.removed_format_chars > _HIDDEN_TEXT_THRESHOLD:
        signals.append(
            Signal(
                SignalSource.HIDDEN_TEXT,
                task,
                f"{essay.removed_format_chars} invisible characters removed",
            )
        )
    if essay.neutralized_markers:
        signals.append(
            Signal(SignalSource.MARKER, task, f"{essay.neutralized_markers} fake essay markers")
        )
    return signals


def implausible_band_signals(
    task: int, words: int, min_words: int, criteria: Mapping[Criterion, Decimal]
) -> list[Signal]:
    """A high band an essay this short can't earn: the model may have been steered."""
    task_criterion = criteria.get(Criterion.TASK_ACHIEVEMENT, criteria.get(Criterion.TASK_RESPONSE))
    short = words < min_words and task_criterion is not None and task_criterion >= _IMPLAUSIBLE_BAND
    very_short = words < min_words / 2 and any(b >= _IMPLAUSIBLE_BAND for b in criteria.values())
    if not (short or very_short):
        return []
    return [
        Signal(
            SignalSource.IMPLAUSIBLE_BAND,
            task,
            f"{words} words (minimum {min_words}) with a band of 7 or more",
        )
    ]
