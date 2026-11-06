from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal as D
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from core.models import (
    AIAssessment,
    AssessmentStatus,
    Role,
    SessionMode,
    Skill,
    TestSession,
    User,
)
from core.schemas.session import AnswerInput
from core.services import ai_grading, grades, sessions
from core.services.ai_grading import GradingRunner
from core.services.bands import TASK_CRITERIA
from core.settings import get_settings
from tests.ai_helpers import FakeOpenRouter, completion, model_output
from tests.content_factories import writing_staff
from tests.grading_helpers import grade_of, requested
from tests.helpers import broken_answer_key, correct_answers, publish_test
from tests.test_ai_grading import BOTH, ESSAY1, ESSAY2, graded

MakeUser = Callable[..., Awaitable[tuple[User, str]]]
Runner = tuple[GradingRunner, FakeOpenRouter]
NOW = datetime(2026, 10, 26, 9, 0, tzinfo=UTC)


class _SilentLog:
    def exception(self, event: str, **kw: Any) -> None:
        return None


def h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def start(
    db: AsyncSession,
    user: User,
    skill: Skill,
    mode: SessionMode = SessionMode.EXAM,
    now: datetime = NOW,
    answers: dict[int, Any] | None = None,
) -> TestSession:
    v = await publish_test(db, skill)
    ts = await sessions.start_session(db, user, v.test_id, mode, now)
    if answers:
        inputs = [AnswerInput(question=q, value=a) for q, a in answers.items()]
        await sessions.save_answers(db, user, ts.id, inputs, now)
    return ts


async def result(client: AsyncClient, tok: str, ts: TestSession) -> dict[str, Any]:
    resp = await client.get(f"/sessions/{ts.id}/result", headers=h(tok))
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    return body


def rows(body: dict[str, Any]) -> dict[int, dict[str, Any]]:
    return {q["number"]: q for q in body["questions"]}


async def test_result_graded_listening(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    answers: dict[int, Any] = dict(correct_answers(Skill.LISTENING))
    answers |= {21: ["B", "C"], 31: " Word31 "}
    ts = await start(db_session, user, Skill.LISTENING, answers=answers)
    await sessions.submit_session(db_session, user, ts.id, NOW + timedelta(minutes=20))

    body = await result(app_client, tok, ts)
    assert body["status"] == "graded"
    assert (body["raw_score"], body["max_score"], body["answered"]) == (39, 40, 40)
    assert body["band"] == 9.0
    assert (body["skill"], body["module"], body["mode"]) == ("listening", None, "exam")
    assert body["time_spent_seconds"] == 20 * 60
    assert sum(q["marks"] for q in body["questions"]) == body["raw_score"]
    numbers = [q["number"] for q in body["questions"]]
    assert numbers == sorted(numbers)

    by = rows(body)
    assert by[21] == {
        "number": 21,
        "numbers": [21, 22],
        "kind": "choice",
        "answer": ["B", "C"],
        "accepted": ["B", "D"],
        "correct_choices": ["B"],
        "marks": 1,
        "max_marks": 2,
        "section": 3,
        "question_type": "multiple_choice",
    }
    assert body["sections"] == [{"number": n, "title": f"L{n}"} for n in (1, 2, 3, 4)]
    assert (by[31]["answer"], by[31]["accepted"], by[31]["marks"]) == (
        " Word31 ",
        ["word31", "alt31"],
        1,
    )
    assert by[31]["correct_choices"] is None


async def test_result_reading_question_types(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    ts = await start(db_session, user, Skill.READING, answers=dict(correct_answers(Skill.READING)))
    await sessions.submit_session(db_session, user, ts.id, NOW + timedelta(minutes=20))
    body = await result(app_client, tok, ts)

    by = rows(body)
    assert (by[1]["section"], by[1]["question_type"]) == (1, "true_false_not_given")
    assert (by[8]["section"], by[8]["question_type"]) == (1, "fill_blank")
    assert (by[14]["section"], by[14]["question_type"]) == (2, "multiple_choice")
    assert (by[27]["section"], by[27]["question_type"]) == (3, "matching")
    assert body["sections"] == [
        {"number": 1, "title": "P1"},
        {"number": 2, "title": "P2"},
        {"number": 3, "title": "P3"},
    ]


async def test_result_partial_practice(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    ten = {q: a for q, a in correct_answers(Skill.READING).items() if q <= 10}
    ts = await start(db_session, user, Skill.READING, SessionMode.PRACTICE, answers=ten)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    body = await result(app_client, tok, ts)
    assert body["status"] == "graded"
    assert (body["raw_score"], body["answered"], body["band"]) == (10, 10, None)
    assert body["module"] == "academic"


async def test_result_of_empty_practice(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    ts = await start(db_session, user, Skill.LISTENING, SessionMode.PRACTICE)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    body = await result(app_client, tok, ts)
    assert (body["status"], body["raw_score"], body["band"]) == ("graded", 0, None)
    assert all(q["answer"] is None for q in body["questions"])
    assert rows(body)[21]["correct_choices"] == []


async def test_result_in_progress_is_409(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    ts = await start(db_session, user, Skill.READING, SessionMode.PRACTICE)
    resp = await app_client.get(f"/sessions/{ts.id}/result", headers=h(tok))
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "conflict"


async def test_result_other_user_404(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, _ = await make_user()
    _, other = await make_user()
    ts = await start(db_session, user, Skill.READING)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    resp = await app_client.get(f"/sessions/{ts.id}/result", headers=h(other))
    assert resp.status_code == 404


async def test_result_requires_auth(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, _ = await make_user()
    ts = await start(db_session, user, Skill.READING)
    assert (await app_client.get(f"/sessions/{ts.id}/result")).status_code == 401


async def test_result_submits_expired_exam(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    started = datetime.now(UTC) - timedelta(hours=2)
    ts = await start(db_session, user, Skill.READING, now=started)
    body = await result(app_client, tok, ts)
    assert (body["status"], body["submit_reason"]) == ("graded", "timeout")
    assert (body["raw_score"], body["band"]) == (0, 0.0)
    assert body["time_spent_seconds"] == 3600


async def test_result_time_spent_practice(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    ts = await start(db_session, user, Skill.READING, SessionMode.PRACTICE)
    await sessions.submit_session(db_session, user, ts.id, NOW + timedelta(seconds=125))
    body = await result(app_client, tok, ts)
    assert body["time_spent_seconds"] == 125
    assert (body["mode"], body["submit_reason"]) == ("practice", "student")


async def test_result_writing_being_graded(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    ts = await start(db_session, user, Skill.WRITING)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    body = await result(app_client, tok, ts)
    assert body["status"] == "being_graded"
    nulls = ("raw_score", "max_score", "band", "answered", "questions")
    assert {k: body[k] for k in nulls} == dict.fromkeys(nulls)


async def test_result_failed_scoring_being_graded(
    app_client: AsyncClient,
    db_session: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, tok = await make_user()
    ts = await start(db_session, user, Skill.READING)
    async with broken_answer_key(db_session, ts.test_version_id):
        with monkeypatch.context() as m:
            m.setattr(grades, "log", _SilentLog())
            await sessions.submit_session(db_session, user, ts.id, NOW)
        body = await result(app_client, tok, ts)
    assert (body["status"], body["raw_score"], body["questions"]) == ("being_graded", None, None)


async def test_openapi_has_result_route(app_client: AsyncClient) -> None:
    spec = (await app_client.get("/openapi.json")).json()
    op = spec["paths"]["/sessions/{session_id}/result"]["get"]
    assert op["operationId"] == "get_session_result"
    assert op["tags"] == ["sessions"]


class RecordingLog:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def exception(self, event: str, **kw: Any) -> None:
        self.events.append((event, kw))

    def warning(self, event: str, **kw: Any) -> None:
        self.events.append((event, kw))


async def test_result_survives_marking_failure_on_read(
    app_client: AsyncClient,
    db_session: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, tok = await make_user()
    full = dict(correct_answers(Skill.READING))
    ts = await start(db_session, user, Skill.READING, answers=full)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    log = RecordingLog()
    monkeypatch.setattr(sessions, "log", log)
    # A marking bug shipped after it was scored.
    async with broken_answer_key(db_session, ts.test_version_id):
        body = await result(app_client, tok, ts)
    assert (body["status"], body["raw_score"], body["band"]) == ("graded", 40, 9.0)
    assert (body["questions"], body["answered"]) == (None, None)
    assert [e for e, _ in log.events] == ["auto_grading_failed"]


async def test_result_logs_drift_and_keeps_stored_total(
    app_client: AsyncClient,
    db_session: AsyncSession,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, tok = await make_user()
    full = dict(correct_answers(Skill.READING))
    ts = await start(db_session, user, Skill.READING, answers=full)
    await sessions.submit_session(db_session, user, ts.id, NOW)
    # Scored under older rules that gave 39 (band 8.5); today's rules give 40.
    await db_session.execute(
        update(TestSession).where(TestSession.id == ts.id).values(raw_score=39, band=D("8.5"))
    )
    await db_session.commit()
    log = RecordingLog()
    monkeypatch.setattr(sessions, "log", log)

    body = await result(app_client, tok, ts)
    assert (body["raw_score"], body["band"]) == (39, 8.5)
    assert log.events == [
        ("auto_grading_drift", {"session_id": str(ts.id), "stored": 39, "recomputed": 40})
    ]


async def writing_submitted(
    client: AsyncClient,
    db: AsyncSession,
    user: User,
    tok: str,
    essays: dict[int, Any],
    mode: SessionMode = SessionMode.EXAM,
) -> TestSession:
    ts = await start(db, user, Skill.WRITING, mode, answers=essays)
    resp = await client.post(f"/sessions/{ts.id}/submit", headers=h(tok))
    assert resp.status_code == 200, resp.text
    await ai_grading.drain()
    return ts


async def test_result_writing_graded(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output())]
    user, tok = await make_user()
    ts = await writing_submitted(app_client, db_session, user, tok, BOTH)

    body = await result(app_client, tok, ts)
    assert (body["status"], body["band"], body["grading_method"]) == ("graded", 6.0, "ai")
    assert body["raw_score"] is None and body["questions"] is None
    assert body["sections"] is None
    writing = body["writing"]
    assert [t["number"] for t in writing["tasks"]] == [1, 2]
    assert all(len(t["criteria"]) == 4 for t in writing["tasks"])
    assert [t["band"] for t in writing["tasks"]] == [6.0, 6.0]
    assert writing["focus"]
    assert [t["text"] for t in writing["tasks"]] == [ESSAY1, ESSAY2]


async def test_result_writing_being_graded_states(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser
) -> None:
    user, tok = await make_user()
    for status in (AssessmentStatus.PROCESSING, AssessmentStatus.HELD, AssessmentStatus.FAILED):
        ts = await writing_submitted(app_client, db_session, user, tok, BOTH)
        await db_session.execute(
            update(AIAssessment)
            .where(AIAssessment.test_session_id == ts.id)
            .values(status=status, band=D("6.0"), result={"tasks": [], "focus": []})
        )
        await db_session.commit()
        body = await result(app_client, tok, ts)
        assert (body["status"], body["writing"], body["band"]) == ("being_graded", None, None)


async def test_result_practice_blank_task(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output(tasks=(2,)))]
    user, tok = await make_user()
    ts = await writing_submitted(
        app_client, db_session, user, tok, {2: BOTH[2]}, SessionMode.PRACTICE
    )

    body = await result(app_client, tok, ts)
    assert (body["status"], body["band"]) == ("graded", None)
    task1, task2 = body["writing"]["tasks"]
    assert (task1["band"], task1["criteria"]) == (None, [])
    assert task2["band"] == 6.0
    assert task1["text"] == ""
    assert task2["text"] == BOTH[2]


async def test_result_writing_stored_shape_unchanged(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output())]
    user, tok = await make_user()
    ts = await writing_submitted(app_client, db_session, user, tok, BOTH)

    stored = await db_session.scalar(
        select(AIAssessment.result).where(AIAssessment.test_session_id == ts.id)
    )
    assert stored is not None and stored["tasks"]
    assert all("text" not in t for t in stored["tasks"])


async def _stored_comments(body: dict[str, Any]) -> list[dict[str, Any]]:
    return [c for t in body["writing"]["tasks"] for k in t["criteria"] for c in k["comments"]]


async def test_result_serves_comment_kind(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output())]
    user, tok = await make_user()
    ts = await writing_submitted(app_client, db_session, user, tok, BOTH)
    stored = await db_session.scalar(
        select(AIAssessment.result).where(AIAssessment.test_session_id == ts.id)
    )
    assert stored is not None
    stored["tasks"][0]["criteria"][0]["comments"][0]["kind"] = "strength"
    await db_session.execute(
        update(AIAssessment).where(AIAssessment.test_session_id == ts.id).values(result=stored)
    )
    await db_session.commit()

    body = await result(app_client, tok, ts)
    comment = body["writing"]["tasks"][0]["criteria"][0]["comments"][0]
    assert comment["kind"] == "strength"


async def test_result_old_comment_without_kind(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output())]
    user, tok = await make_user()
    ts = await writing_submitted(app_client, db_session, user, tok, BOTH)
    stored = await db_session.scalar(
        select(AIAssessment.result).where(AIAssessment.test_session_id == ts.id)
    )
    assert stored is not None
    for t in stored["tasks"]:
        for k in t["criteria"]:
            for c in k["comments"]:
                del c["kind"]
    await db_session.execute(
        update(AIAssessment).where(AIAssessment.test_session_id == ts.id).values(result=stored)
    )
    await db_session.commit()

    comments = await _stored_comments(await result(app_client, tok, ts))
    assert comments and all(c["kind"] is None for c in comments)


async def test_result_hides_internals(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output())]
    user, tok = await make_user()
    ts = await writing_submitted(app_client, db_session, user, tok, BOTH)

    resp = await app_client.get(f"/sessions/{ts.id}/result", headers=h(tok))
    assert resp.json()["status"] == "graded"
    note = writing_staff()["examiner_notes"][1]
    for secret in (
        "raw_responses",
        "signals",
        "manipulation",
        "prompt_version",
        "writing-academic-v2",
        get_settings().ai_model,
        note,
    ):
        assert secret not in resp.text


async def test_session_list_carries_writing_band(
    app_client: AsyncClient, db_session: AsyncSession, make_user: MakeUser, ai_installed: Runner
) -> None:
    _, fake = ai_installed
    fake.responses = [completion(model_output())]
    user, tok = await make_user()
    ts = await writing_submitted(app_client, db_session, user, tok, BOTH)

    resp = await app_client.get("/sessions", headers=h(tok))
    [item] = [i for i in resp.json()["items"] if i["id"] == str(ts.id)]
    assert item["band"] == 6.0


TEACHER_SCORES = {
    "tasks": [
        {
            "number": 1,
            "criteria": {
                "task_achievement": {"band": 6, "comment": "Overview is missing."},
                "coherence_cohesion": {"band": 6.5, "comment": None},
                "lexical_resource": {"band": 6, "comment": None},
                "grammatical_range_accuracy": {"band": 6.5, "comment": None},
            },
            "feedback": "Add an overview.",
        },
        {
            "number": 2,
            "criteria": {
                "task_response": {"band": 7, "comment": "Clear position."},
                "coherence_cohesion": {"band": 7, "comment": None},
                "lexical_resource": {"band": 7, "comment": None},
                "grammatical_range_accuracy": {"band": 6.5, "comment": None},
            },
            "feedback": "Well argued.",
        },
    ]
}


async def teacher_grades(
    client: AsyncClient, engine: AsyncEngine, make_user: MakeUser, ts: TestSession, **kw: Any
) -> User:
    """A new teacher claims the session's grade and submits `TEACHER_SCORES` (or `scores`)."""
    teacher, tok = await make_user(Role.TEACHER)
    grade = await grade_of(engine, ts)
    assert (await client.post(f"/grading/{grade.id}/claim", headers=h(tok))).status_code == 200
    body = kw.get("scores", TEACHER_SCORES)
    resp = await client.post(f"/grading/{grade.id}/submit", json=body, headers=h(tok))
    assert resp.status_code == 204, resp.text
    return teacher


async def test_teacher_grade_is_the_result(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    ts, _, tok = await requested(db_session, make_user)
    assert (await result(app_client, tok, ts))["status"] == "being_graded"

    teacher = await teacher_grades(app_client, _engine, make_user, ts)

    resp = await app_client.get(f"/sessions/{ts.id}/result", headers=h(tok))
    body = resp.json()
    assert (body["status"], body["band"], body["grading_method"]) == ("graded", 6.5, "human")
    one, two = body["writing"]["tasks"]
    assert (one["band"], one["feedback"], two["band"], two["feedback"]) == (
        6.5,
        "Add an overview.",
        7.0,
        "Well argued.",
    )
    assert [c["criterion"] for c in one["criteria"]] == [
        "task_achievement",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range_accuracy",
    ]
    assert one["criteria"][0]["comments"] == [
        {"comment": "Overview is missing.", "quote": None, "suggestion": None, "kind": None}
    ]
    assert one["criteria"][1]["comments"] == []
    assert (one["text"], two["text"]) == (ESSAY1, ESSAY2)
    assert one["word_count"] > 0
    assert body["writing"]["focus"] == []
    assert str(teacher.id) not in resp.text and teacher.email not in resp.text


async def test_flagged_session_shows_teacher_grade_not_ai(
    app_client: AsyncClient,
    db_session: AsyncSession,
    _engine: AsyncEngine,
    make_user: MakeUser,
    ai_runner: Runner,
) -> None:
    user, tok = await make_user()
    ts = await graded(db_session, user, ai_runner, AssessmentStatus.HELD)
    ai_band = await db_session.scalar(
        select(AIAssessment.band).where(AIAssessment.test_session_id == ts.id)
    )
    nines = {"band": 9, "comment": None}
    scores = {
        "tasks": [
            {"number": n, "criteria": dict.fromkeys(names, nines), "feedback": "Excellent."}
            for n, names in ((1, TASK_CRITERIA[1]), (2, TASK_CRITERIA[2]))
        ]
    }

    await teacher_grades(app_client, _engine, make_user, ts, scores=scores)

    body = await result(app_client, tok, ts)
    assert ai_band is not None and ai_band != D(9)
    assert (body["status"], body["band"]) == ("graded", 9.0)
    bands = {c["band"] for t in body["writing"]["tasks"] for c in t["criteria"]}
    assert bands == {9.0}
    assert body["writing"]["focus"] == []
    assert all(t["feedback"] == "Excellent." for t in body["writing"]["tasks"])


async def test_claimed_and_draft_stay_being_graded(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    ts, _, tok = await requested(db_session, make_user)
    _, teacher = await make_user(Role.TEACHER)
    grade = await grade_of(_engine, ts)
    assert (
        await app_client.post(f"/grading/{grade.id}/claim", headers=h(teacher))
    ).status_code == 200
    draft = {"tasks": [TEACHER_SCORES["tasks"][0]]}
    saved = await app_client.put(f"/grading/{grade.id}/draft", json=draft, headers=h(teacher))
    assert saved.status_code == 200, saved.text

    body = await result(app_client, tok, ts)

    assert (body["status"], body["writing"], body["band"]) == ("being_graded", None, None)
    assert "Add an overview." not in str(body)


async def test_teacher_grade_blank_practice_task(
    app_client: AsyncClient, db_session: AsyncSession, _engine: AsyncEngine, make_user: MakeUser
) -> None:
    ts, _, tok = await requested(db_session, make_user, essays={2: ESSAY2})
    await teacher_grades(
        app_client, _engine, make_user, ts, scores={"tasks": [TEACHER_SCORES["tasks"][1]]}
    )

    body = await result(app_client, tok, ts)

    assert (body["status"], body["band"]) == ("graded", None)
    one, two = body["writing"]["tasks"]
    assert (one["band"], one["criteria"], one["text"], one["word_count"]) == (None, [], "", 0)
    assert one["feedback"] is None
    assert two["band"] == 7.0
