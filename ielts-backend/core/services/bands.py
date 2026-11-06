"""IELTS band arithmetic, shared by human and AI grading.

Criterion bands are 0-9 in half-band steps. Averages are rounded with the British
Council rule: to the nearest half band, where .25 rounds up to the next half band and
.75 up to the next whole band (i.e. nearest 0.5, ties up).

Reading and Listening convert a raw mark (0-40) to a band with fixed tables instead.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

from core.models.enums import Criterion, Module, SessionMode, Skill
from core.schemas.session import WritingCriterion, WritingTask

_HALF = Decimal("0.5")
_ONE_DECIMAL = Decimal("0.1")
_CRITERIA_PER_SCORE = 4


def validate_criterion_band(value: Decimal) -> Decimal:
    if not (Decimal(0) <= value <= Decimal(9)) or value % _HALF != 0:
        raise ValueError(f"criterion band must be 0-9 in steps of 0.5, got {value}")
    return value


def round_band(value: Decimal) -> Decimal:
    halves = (value * 2 + _HALF).to_integral_value(rounding=ROUND_FLOOR)
    return (halves / 2).quantize(_ONE_DECIMAL)


def _mean(criteria: Sequence[Decimal]) -> Decimal:
    if len(criteria) != _CRITERIA_PER_SCORE:
        raise ValueError(f"expected {_CRITERIA_PER_SCORE} criteria, got {len(criteria)}")
    return sum((validate_criterion_band(c) for c in criteria), Decimal(0)) / len(criteria)


def task_band(criteria: Sequence[Decimal]) -> Decimal:
    return round_band(_mean(criteria))


def speaking_overall(criteria: Sequence[Decimal]) -> Decimal:
    return round_band(_mean(criteria))


def writing_overall(task1: Sequence[Decimal], task2: Sequence[Decimal]) -> Decimal:
    # Task 2 counts double; the task means stay unrounded so only the final band rounds.
    return round_band((_mean(task1) + 2 * _mean(task2)) / 3)


def _table(*rows: tuple[int, str]) -> tuple[tuple[int, Decimal], ...]:
    return tuple((low, Decimal(band)) for low, band in rows)


# Raw mark -> band: each row is the lowest raw mark for its band, highest band first. These
# are the commonly published tables (spec §4.2); rows below 4.0 extend them smoothly.
_RAW_BAND_TABLES: dict[tuple[Skill, Module | None], tuple[tuple[int, Decimal], ...]] = {
    (Skill.LISTENING, None): _table(
        (39, "9.0"), (37, "8.5"), (35, "8.0"), (32, "7.5"), (30, "7.0"), (26, "6.5"),
        (23, "6.0"), (18, "5.5"), (16, "5.0"), (13, "4.5"), (10, "4.0"), (8, "3.5"),
        (6, "3.0"), (4, "2.5"), (2, "2.0"), (1, "1.0"), (0, "0.0"),
    ),
    (Skill.READING, Module.ACADEMIC): _table(
        (39, "9.0"), (37, "8.5"), (35, "8.0"), (33, "7.5"), (30, "7.0"), (27, "6.5"),
        (23, "6.0"), (19, "5.5"), (15, "5.0"), (13, "4.5"), (10, "4.0"), (8, "3.5"),
        (6, "3.0"), (4, "2.5"), (2, "2.0"), (1, "1.0"), (0, "0.0"),
    ),
    (Skill.READING, Module.GENERAL_TRAINING): _table(
        (40, "9.0"), (39, "8.5"), (37, "8.0"), (36, "7.5"), (35, "7.0"), (32, "6.5"),
        (30, "6.0"), (27, "5.5"), (23, "5.0"), (19, "4.5"), (15, "4.0"), (12, "3.5"),
        (9, "3.0"), (6, "2.5"), (3, "2.0"), (1, "1.0"), (0, "0.0"),
    ),
}  # fmt: skip
_MAX_RAW = 40


def raw_to_band(skill: Skill, module: Module | None, raw: int) -> Decimal:
    """The band for a Reading/Listening raw mark. Listening ignores `module`."""
    if not 0 <= raw <= _MAX_RAW:
        raise ValueError(f"raw mark must be 0-{_MAX_RAW}, got {raw}")
    table = _RAW_BAND_TABLES.get((skill, None if skill == Skill.LISTENING else module))
    if table is None:
        raise ValueError(f"no band table for {skill} with module {module}")
    return next(band for low, band in table if raw >= low)


# The criteria each Writing task is judged on, in the order they are shown and stored.
TASK_CRITERIA: dict[int, tuple[Criterion, ...]] = {
    1: (
        Criterion.TASK_ACHIEVEMENT,
        Criterion.COHERENCE_COHESION,
        Criterion.LEXICAL_RESOURCE,
        Criterion.GRAMMATICAL_RANGE_ACCURACY,
    ),
    2: (
        Criterion.TASK_RESPONSE,
        Criterion.COHERENCE_COHESION,
        Criterion.LEXICAL_RESOURCE,
        Criterion.GRAMMATICAL_RANGE_ACCURACY,
    ),
}

_ZEROS = (Decimal(0),) * _CRITERIA_PER_SCORE


@dataclass(frozen=True)
class WritingBands:
    task1: Decimal | None
    task2: Decimal | None
    overall: Decimal | None


def writing_bands(
    mode: SessionMode, criteria: Mapping[int, Sequence[Decimal] | None]
) -> WritingBands:
    """Task and overall bands; `None` criteria mean a blank task. In an exam a blank task
    scores 0 and the overall is always given; in practice it isn't graded, and the overall
    needs both tasks."""
    filled = {
        n: (list(_ZEROS) if c is None and mode == SessionMode.EXAM else c)
        for n, c in ((n, criteria.get(n)) for n in (1, 2))
    }
    t1, t2 = filled[1], filled[2]
    return WritingBands(
        task1=task_band(t1) if t1 is not None else None,
        task2=task_band(t2) if t2 is not None else None,
        overall=writing_overall(t1, t2) if t1 is not None and t2 is not None else None,
    )


def blank_writing_task(number: int, mode: SessionMode) -> WritingTask:
    """A blank task as served: zero on every criterion in an exam, not graded in practice."""
    criteria = (
        [WritingCriterion(criterion=c, band=Decimal(0), comments=[]) for c in TASK_CRITERIA[number]]
        if mode == SessionMode.EXAM
        else []
    )
    return WritingTask(number=number, band=None, word_count=0, criteria=criteria)
