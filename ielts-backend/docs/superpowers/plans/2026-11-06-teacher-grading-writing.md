# Teacher Grading (Writing, backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Writing sessions that need a teacher (requested at submission, AI failed, or AI held for suspected manipulation) enter one queue. A teacher claims, grades and submits them. The student's result page shows the teacher's grade, and admins can release or reassign a stuck claim.

**Architecture:**
- **Data and service:** one `human_grades` row per teacher-graded session is the queue entry, the claim and the draft. `core/services/human_grading.py` owns the queue, claim, release, reassign, detail, draft and submit.
- **Where grades are written:** `core/services/grades.py` stays the only writer of a session's grade. It gains `record_human_grade`, and `record_ai_outcome` hands `failed` and `held` outcomes to the queue in the same transaction.
- **HTTP:** a new `grading` router serves teachers. Admin release and reassign go on the existing `admin` router.
- **Result page:** a teacher grade is served as the same `WritingResultView` the AI path uses, so the result page needs no new shape.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async + asyncpg, Alembic, Pydantic v2, pytest + testcontainers Postgres, structlog.

**Spec:** `docs/superpowers/specs/2026-10-24-human-grading-design.md` (§3–§6, §8, §9 rows for `grading` and admin claims; §4.1 for AI failure and held essays).

**Out of scope (later plans):**
- Speaking, which needs recording uploads first: `start_session` still refuses Speaking.
- The admin all-results list and overview (§7 "All graded tests", "Overview").
- The frontend: teacher screens, the "Request manual grading" toggle, and showing teacher feedback.

## Global Constraints

- **Shipping:** merge when done, but don't deploy until the frontend teacher screens land. After deploy, failed and held AI essays wait for a teacher instead of `regrade-ai` / `held-ai`.
- **Branch and checks:** work on `feat/teacher-grading`. `uv run ruff check .`, `uv run ruff format --check .` and `uv run mypy .` (strict) pass at every commit.
- **Schema:** schema changes only via Alembic migration `0006`; `create_all` only in tests.
- **Code conventions:** services raise `AppError` subclasses, never `HTTPException`. Routers stay thin. Never return ORM objects.
- **Statuses and origins:**
  - `human_grades.status` ∈ `awaiting_grader | claimed | graded`.
  - `origin` ∈ `speaking | student_request | ai_fallback | ai_flagged`. `speaking` is defined but nothing creates it yet.
- **Writing criteria:**
  - Task 1: `task_achievement`, `coherence_cohesion`, `lexical_resource`, `grammatical_range_accuracy`.
  - Task 2: `task_response` plus the same three.
  - Reuse `core/ai/output.TASK_CRITERIA`.
- **Bands:**
  - Criterion bands are `Decimal`, 0–9 in half steps (`bands.validate_criterion_band`).
  - Task band is `bands.task_band`; overall is `bands.writing_overall` (Task 2 double).
  - A blank task (no essay text) is not scored by the teacher and follows `writing_bands(mode, …)`: an exam scores it 0; in practice the overall needs both tasks.
- **Grade writes:** only `core/services/grades.py` writes `test_sessions.band` / `raw_score`. Writing `raw_score` stays null.
- **Settings:** `teacher_max_active_claims: int = 3` and `ai_failure_fallback_to_teacher: bool = True`. A `held` outcome always enters the queue; the setting covers `failed` only.
- **Unique queue entry:** `human_grades.test_session_id` is unique, and every insert is `ON CONFLICT (test_session_id) DO NOTHING`.
- **Queue order:** oldest `test_sessions.submitted_at` first, then `human_grades.id`. A test handed over after AI failure keeps its original place.
- **Roles:** `require_role(Role.TEACHER, Role.ADMIN)` on the `grading` router; `require_role(Role.ADMIN)` on admin endpoints (already on that router).
- **Errors:**
  - Claiming your own test → `ForbiddenError` (403).
  - Already claimed, or over the claim limit → `ConflictError` (409).
  - Unknown grade id → `NotFoundError` (404).
  - When a teacher's conditional `UPDATE` (release, draft, submit) changes nothing, pick the error in this order:
    1. unknown grade → 404;
    2. already `graded` → 409;
    3. `claimed_by` isn't the caller, including null after a release → 403;
    4. otherwise → 409.
- **Route order:** declare `/grading/queue` and `/grading/mine` before `/grading/{grade_id}`, so `mine` is never parsed as a UUID.
- **Student view:** students see only `being_graded` until `status = graded`. They never see the teacher's identity, a draft, signals, or the AI draft of a flagged essay.
- **Signed URLs:** the Task 1 chart uses `storage.signed_get_url` (existing TTL setting).
- **Logs:** they never contain essay text. Event names: `human_grading_queued`, `human_grading_claimed`, `human_grading_released`, `human_grading_reassigned`, `human_grading_graded`.
- **OpenAPI:** new tag `grading`, described as "Teachers: the grading queue, claims, drafts and grades." Every route has a stable `operation_id` (listed per task).

## Review Focus

1. **Two teachers claim the same grade at the same moment:** exactly one gets 200, the other 409. This is the conditional `UPDATE … WHERE status='awaiting_grader'`. Test in Task 3.
2. **One teacher fires several claims at once at the limit:** they never end up above `teacher_max_active_claims`. Lock the teacher's `users` row (`SELECT … FOR UPDATE`) before counting. Test in Task 3.
3. **Submitting after an admin released or reassigned the claim:** the old teacher's submit is refused with 403, not saved. The submit's conditional `UPDATE` requires `status='claimed' AND claimed_by=:me`. Test in Task 5.
4. **AI keeps running after the hand-off:** a session with a `human_grades` row is never re-graded by `regrade-ai` or the startup resume. Test in Task 2.
5. **A grade for an essay the student left blank:** submit rejects scores for a blank task and requires them for every written task. The bands follow the exam/practice rules. Test in Task 5.

---

### Task 1: `human_grades` model, migration and backfill

**Files:**
- Create: `core/models/human_grade.py`
- Modify: `core/models/enums.py`, `core/models/__init__.py`, `core/settings.py`
- Create: `alembic/versions/0006_human_grades.py`
- Test: `tests/test_models.py`, new `tests/test_migration_0006.py`

**Interfaces:**
- Produces:
  - `HumanGradeStatus(StrEnum)`: `AWAITING_GRADER="awaiting_grader"`, `CLAIMED="claimed"`, `GRADED="graded"`.
  - `HumanGradeOrigin(StrEnum)`: `SPEAKING`, `STUDENT_REQUEST`, `AI_FALLBACK`, `AI_FLAGGED`, with values as in the Global Constraints.
  - `HumanGrade(UUIDPrimaryKeyMixin, TimestampMixin, Base)`, table `human_grades`, with columns:
    - `test_session_id` (FK `test_sessions.id` ondelete CASCADE, unique);
    - `skill: str` (String 16);
    - `status: str` (default `awaiting_grader`);
    - `origin: str`;
    - `claimed_by: UUID | None` (FK users SET NULL);
    - `claimed_at`;
    - `scores: dict | None` (JSONB);
    - `overall_band: Decimal | None` (Numeric 2,1);
    - `graded_by: UUID | None` (FK users SET NULL);
    - `graded_at`.
  - Constraints and indexes:
    - check constraints on `status`, `origin` and `skill`, built with `check_in`;
    - indexes `ix_human_grades_status_created_at (status, created_at)`, `ix_human_grades_graded_by_graded_at (graded_by, graded_at)` and `ix_human_grades_claimed_by (claimed_by)`.
  - Settings: `teacher_max_active_claims`, `ai_failure_fallback_to_teacher`.

- [ ] **Step 1: Write the failing model test** in `tests/test_models.py`:
  - `test_human_grade_unique_per_session`: inserting two `HumanGrade` rows for one session raises `IntegrityError`.
  - `test_human_grade_rejects_unknown_status`: `status="done"` raises `IntegrityError`.
- [ ] **Step 2: Run** `uv run pytest tests/test_models.py -q`. Expected: FAIL, since `HumanGrade` can't be imported.
- [ ] **Step 3: Implement** the enums, the model and the two settings.
- [ ] **Step 4: Write migration `0006`.**
  - Create the table (follow `0005`'s style: named constraints via `op.f`).
  - Then backfill in SQL, each `ON CONFLICT DO NOTHING`, `skill='writing'`, `status='awaiting_grader'`:
    - submitted sessions with `grading_method='human'` and `skill='writing'` → `origin='student_request'`;
    - sessions whose `ai_assessments.status='failed'` → `ai_fallback`;
    - sessions whose `ai_assessments.status='held'` → `ai_flagged`.
  - `downgrade` drops the table.
- [ ] **Step 5: Write the failing migration test** `tests/test_migration_0006.py::test_backfill_queues_waiting_writing`.
  - `alembic/env.py` reads `get_settings().database_url` and calls `asyncio.run`, so this test is a plain **sync** function.
  - Setup:
    - create a fresh database in the testcontainers server with `CREATE DATABASE`, on an asyncpg connection inside `asyncio.run` (asyncpg runs it outside a transaction);
    - point the cached settings at it: `monkeypatch.setattr(get_settings(), "database_url", url)`;
    - run `alembic.command.upgrade(Config("alembic.ini"), "0005")`;
    - insert with SQL a user, a test and a version, plus four submitted Writing sessions: one human, one AI `failed`, one AI `held`, one AI `ready`;
    - then run `upgrade head`.
  - Assertions:
    - exactly three `human_grades` rows exist, with origins `{student_request, ai_fallback, ai_flagged}`;
    - the `ready` session has none;
    - `downgrade 0005` then `upgrade head` again also gives three rows.
- [ ] **Step 6: Run** `uv run pytest tests/test_models.py tests/test_migration_0006.py -q`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(backend): human_grades table with backfill of waiting Writing`.

### Task 2: Sessions reach the queue

**Files:**
- Modify: `core/services/grades.py`, `core/services/sessions.py` (`on_session_submitted`), `core/services/ai_grading.py` (`regrade_failed`), `core/cli.py` (drop `held-ai` and its `ai_review` import), `core/services/ai_review.py` (delete)
- Test: `tests/test_human_grading_queueing.py`, `tests/test_ai_grading_flow.py`, `tests/test_cli.py`, `tests/test_session_result.py`, `tests/ai_helpers.py`, `tests/test_ai_review.py` (delete)

**Interfaces:**
- Consumes: Task 1 model and settings.
- Produces:
  - `grades.enqueue_human(db: AsyncSession, session_id: uuid.UUID, skill: Skill, origin: HumanGradeOrigin) -> bool`: an `INSERT … ON CONFLICT DO NOTHING`. It returns whether a row was inserted, logs `human_grading_queued` when it was, and does not commit.
  - `grades.record_ai_outcome` (existing signature, unchanged) also calls `enqueue_human`:
    - when the new status is `held` → `AI_FLAGGED`;
    - when it is `failed` and `ai_failure_fallback_to_teacher` → `AI_FALLBACK`.
    - It does this in the caller's transaction, only when the assessment actually moved.
  - `on_session_submitted`: `grading_method == HUMAN` and skill writing → `enqueue_human(..., STUDENT_REQUEST)`.

- [ ] **Step 1: Write failing tests** in `tests/test_human_grading_queueing.py`:
  - `test_requested_manual_grading_is_queued`: a Writing session with `request_manual_grading=True`, submitted → one `human_grades` row (`student_request`, `awaiting_grader`), and no `ai_assessments` row.
  - `test_ai_final_failure_hands_to_teacher`: with the `ai_runner` fake failing every attempt, `grade_session` returns `FAILED`; the assessment is `failed` and a `human_grades` row exists with `ai_fallback`.
  - `test_ai_failure_without_fallback_stays_failed`: the setting is off → `failed`, no `human_grades` row.
  - `test_held_essay_hands_to_teacher`: an output that raises a signal → `held`, plus a `human_grades` row with `ai_flagged`; `test_sessions.band` stays null.
  - `test_handed_over_session_is_never_regraded` (Review Focus 4):
    - a failed-and-queued session, then `regrade_failed(runner)` → the assessment stays `failed`, no model call is made, and the counts are all 0;
    - a failed session with fallback off is still retried.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `enqueue_human` and the `record_ai_outcome` hand-off.
  - `regrade_failed` only resets `failed` rows whose session has no `human_grades` row (`NOT EXISTS`).
  - `resume_processing` is unchanged, since it only picks `processing`.
- [ ] **Step 4: Retire `held-ai`.**
  - Delete `core/services/ai_review.py`, and remove the `held-ai` subcommand, its tests in `tests/test_cli.py` and the module docstring line.
  - Before deleting `tests/test_ai_review.py`:
    - move its `graded` helper and `MakeUser` alias into `tests/ai_helpers.py`, since `tests/test_cli.py` imports them;
    - move `test_regrade_failed_only` to `tests/test_ai_grading_flow.py`.
  - `tests/test_session_result.py` calls `ai_review.release_held` (around line 482). Mark that test `pytest.mark.skip(reason="replaced in Task 7")`; Task 7's `test_flagged_session_shows_teacher_grade_not_ai` replaces it, and Task 7 deletes it.
  - Afterwards, grepping `ai_review|release_held|test_ai_review` across `core/`, `api/` and `tests/` finds nothing.
- [ ] **Step 5: Run** `uv run pytest tests/test_human_grading_queueing.py tests/test_ai_grading_flow.py tests/test_ai_grading.py tests/test_cli.py tests/test_sessions_submit.py tests/test_session_result.py -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(backend): requested, failed and held Writing enter the teacher queue`.

### Task 3: Queue, mine, claim and release

**Files:**
- Create: `core/services/human_grading.py`, `core/schemas/grading.py`, `api/routers/grading.py`
- Modify: `api/main.py` (include router, add `grading` tag)
- Test: `tests/test_grading_queue.py`

**Interfaces:**
- Consumes: Task 1 model, Task 2 `enqueue_human` (tests seed the queue through real submissions).
- Produces:
  - `QueueItem` (in `core/schemas/grading.py`): `grade_id: UUID`, `session_id: UUID`, `skill: Skill`, `origin: HumanGradeOrigin`, `status: HumanGradeStatus`, `test_title: str`, `student_email: str`, `submitted_at: datetime`, `claimed_at: datetime | None`.
  - `QueuePage`: `items: list[QueueItem]`, `total: int`.
  - Service functions in `human_grading`, with `now` optional and defaulting to UTC now:
    - `list_queue(db, *, skill: Skill | None, limit: int, offset: int) -> tuple[list[QueueItem], int]`
    - `list_mine(db, teacher: User) -> list[QueueItem]`
    - `claim(db, teacher: User, grade_id: UUID, now=None) -> QueueItem`
    - `release(db, teacher: User, grade_id: UUID) -> None`
  - Routes (tag `grading`, all `require_role(TEACHER, ADMIN)`):
    - `GET /grading/queue?skill=&limit=50&offset=0` → `QueuePage`, `operation_id="grading_queue"`;
    - `GET /grading/mine` → `list[QueueItem]`, `"grading_mine"`;
    - `POST /grading/{grade_id}/claim` → `QueueItem`, `"grading_claim"`;
    - `POST /grading/{grade_id}/release` → 204, `"grading_release"`.

- [ ] **Step 1: Write failing tests** in `tests/test_grading_queue.py`, through `app_client`:
  - `test_queue_oldest_submission_first`: three requested-manual sessions submitted at `NOW`, `NOW-1h`, `NOW+1h` → queue order by `submitted_at`; an `ai_fallback` row created later but submitted earliest comes first.
  - `test_queue_filters_by_skill_and_hides_claimed`.
  - `test_student_cannot_see_queue`: 403.
  - `test_claim_and_mine`: a claim returns `status="claimed"`; `GET /grading/mine` lists it; the queue no longer does.
  - `test_cannot_claim_own_test`: a teacher who submitted the session gets 403.
  - `test_claim_race_one_winner` (Review Focus 1): two teachers `asyncio.gather` claims on one grade through `app_client` → status codes `{200, 409}`. Each test request gets its own database session, so they really race.
  - `test_claim_limit` (Review Focus 2):
    - with `teacher_max_active_claims=2`, a third sequential claim gets 409;
    - three concurrent claims from one teacher with the limit at 2 → exactly two succeed.
  - `test_release_returns_to_queue_and_drops_draft`: the draft is set to a value directly in the DB, then released → `awaiting_grader`, `claimed_by` null, `scores` null.
  - `test_release_someone_elses_claim_forbidden`: 403.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Claim:
    1. lock the teacher's row with `SELECT … FOR UPDATE`;
    2. count their `claimed` rows; if the count is at the limit → `ConflictError`;
    3. check the session owner → `ForbiddenError`;
    4. run a conditional `UPDATE … WHERE status='awaiting_grader' RETURNING`; no row → `ConflictError("already claimed")`.
  - Release: a conditional `UPDATE` back to `awaiting_grader` with `claimed_by=:me`. If nothing moves, follow the error order in the Global Constraints.
  - Log `human_grading_claimed` and `human_grading_released`.
- [ ] **Step 4: Run** `uv run pytest tests/test_grading_queue.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): teacher grading queue with atomic claims`.

### Task 4: Grade detail and drafts

**Files:**
- Modify: `core/services/human_grading.py`, `core/schemas/grading.py`, `api/routers/grading.py`
- Test: `tests/test_grading_detail.py`

**Interfaces:**
- Consumes: Task 3 `claim`.
- Produces:
  - `CriterionScore`: `band: Band`, `comment: str | None = None` (max 2000 chars). Here `Band` is the existing `Decimal` alias, validated with `validate_criterion_band`.
  - `TaskScoresDraft`: `number: int`, `criteria: dict[Criterion, CriterionScore | None]`, `feedback: str | None` (max 5000).
  - `WritingScoresDraft`: `tasks: list[TaskScoresDraft]`.
  - `GradingTask`: `number`, `prompt: str`, `image_url: str | None`, `min_words: int`, `text: str` (`""` when blank), `word_count: int` (`core.ai.injection.word_count` on the cleaned text).
  - `AIDraft`: `band: Band | None`, `result: WritingResult | None`, `signals: list[dict[str, Any]]`. Present only for `ai_flagged`.
  - `GradeDetail`: `QueueItem` fields plus `mode: SessionMode`, `tasks: list[GradingTask]`, `draft: WritingScoresDraft | None`, `ai: AIDraft | None`.
  - Service: `get_detail(db, user: User, grade_id) -> GradeDetail` and `save_draft(db, teacher: User, grade_id, draft: WritingScoresDraft) -> WritingScoresDraft`.
  - Routes:
    - `GET /grading/{grade_id}` → `GradeDetail`, `"grading_detail"`. The claiming teacher or an admin can open it; others get 403.
    - `PUT /grading/{grade_id}/draft` → `WritingScoresDraft`, `"grading_save_draft"`. Only the claiming teacher may save; otherwise 403. The grade must be `claimed`, otherwise 409.

- [ ] **Step 1: Write failing tests** in `tests/test_grading_detail.py`:
  - `test_detail_has_prompts_essays_and_word_counts`: Task 1 `image_url` comes from a stubbed `storage.signed_get_url` (R2 mocked, as `test_sessions_router.py` does); Task 2 `text` is the saved essay; `word_count` matches.
  - `test_blank_task_has_empty_text_and_zero_words`.
  - `test_flagged_detail_shows_ai_draft_and_signals`: a held essay (via `ai_runner`) → `ai.signals` is non-empty and `ai.band` is set. For a `student_request` grade, `ai` is null.
  - `test_detail_forbidden_to_other_teacher` (403) and `test_detail_open_to_admin` (200).
  - `test_draft_round_trip`: a partial draft (one criterion band, no feedback) is saved and read back in `detail.draft`.
  - `test_draft_rejects_bad_band`: `6.3` → 422.
  - `test_draft_rejects_wrong_criterion_for_task`: `task_response` on Task 1 → 422.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The criterion-per-task check uses `TASK_CRITERIA` in a model validator.
  - The draft is stored in `scores` as `model_dump(mode="json")`.
- [ ] **Step 4: Run** `uv run pytest tests/test_grading_detail.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): grading detail and drafts`.

### Task 5: Submit a teacher grade

**Files:**
- Modify: `core/services/grades.py`, `core/services/human_grading.py`, `core/schemas/grading.py`, `api/routers/grading.py`
- Move: `writing_bands` / `WritingBands` and `_blank_task` (renamed `blank_writing_task`) from `core/services/ai_grading.py` to `core/services/bands.py`, with `ai_grading` importing them. Task 7 uses `blank_writing_task`.
- Test: `tests/test_grading_submit.py`

**Interfaces:**
- Consumes: Task 4 schemas and the draft.
- Produces:
  - `TaskScores`: `number`, `criteria: dict[Criterion, CriterionScore]` (exactly the task's four), `feedback: str` (1–5000 chars).
  - `WritingScores`: `tasks: list[TaskScores]`.
  - `grades.record_human_grade(db, grade_id: UUID, teacher_id: UUID, scores: dict[str, Any], bands: WritingBands, now: datetime) -> uuid.UUID | None`:
    - a conditional `UPDATE human_grades SET status='graded', scores, overall_band=bands.overall, graded_by, graded_at WHERE id=:grade_id AND status='claimed' AND claimed_by=:teacher_id RETURNING test_session_id`;
    - then `test_sessions.band = bands.overall`;
    - it returns the session id, or `None` if nothing moved. It does not commit.
  - `human_grading.submit(db, teacher: User, grade_id, scores: WritingScores, now=None) -> None`.
  - Route: `POST /grading/{grade_id}/submit` → 204, `"grading_submit"`.

- [ ] **Step 1: Write failing tests** in `tests/test_grading_submit.py`:
  - `test_submit_computes_bands`:
    - Task 1 criteria `6, 6.5, 6, 6.5` (mean 6.25 → task band 6.5);
    - Task 2 criteria `7, 7, 7, 6.5` (mean 6.875 → task band 7.0);
    - overall = `round_band((6.25 + 2×6.875)/3)` = `round_band(6.666…)` = `6.5`;
    - the session's `band` is `6.5` and `human_grades.overall_band` is `6.5`.
  - `test_submit_requires_every_criterion_and_feedback`: a missing criterion → 422; empty feedback → 422.
  - `test_submit_blank_task_rules` (Review Focus 5):
    - an exam with Task 1 blank → scores for Task 1 are rejected (422);
    - with Task 2 only, the overall comes from Task 1 = zeros;
    - in practice with Task 1 blank → the overall is null and the result is still `graded`.
  - `test_submit_after_release_is_refused` (Review Focus 3): teacher A claims, admin releases (Task 6 service called directly, or a direct DB update if Task 6 isn't done yet), A submits → 403, and nothing is written.
  - `test_grade_is_final`: a second submit → 409.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Validation compares the submitted task numbers with the session's written tasks: those with non-blank text.
  - Bands come from `bands.writing_bands(mode, {n: [criteria bands in TASK_CRITERIA order] or None})`.
  - Log `human_grading_graded` with `band`.
- [ ] **Step 4: Run** `uv run pytest tests/test_grading_submit.py tests/test_ai_grading.py tests/test_bands.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): teachers submit Writing grades`.

### Task 6: Admin release and reassign

**Files:**
- Modify: `core/services/human_grading.py`, `api/routers/admin.py`, `core/schemas/grading.py`
- Test: `tests/test_grading_admin.py`

**Interfaces:**
- Consumes: Task 3 claim state.
- Produces:
  - `ReassignRequest`: `teacher_id: UUID`.
  - Service:
    - `admin_release(db, admin: User, grade_id) -> None`: the draft is discarded; the grade must be `claimed`, otherwise 409.
    - `reassign(db, admin: User, grade_id, teacher_id) -> QueueItem`.
  - Routes on the admin router:
    - `POST /admin/grading/{grade_id}/release` → 204, `"admin_grading_release"`;
    - `POST /admin/grading/{grade_id}/reassign` → `QueueItem`, `"admin_grading_reassign"`.

- [ ] **Step 1: Write failing tests**:
  - `test_admin_releases_any_claim`: back in the queue with no draft.
  - `test_reassign_moves_claim_and_draft`: the target gets the claim and the same `scores`, even when the target is at the claim limit.
  - `test_reassign_target_must_be_teacher_or_admin`: a student target → 409.
  - `test_reassign_target_cannot_be_the_student`: 403.
  - `test_reassign_awaiting_grade`: an unclaimed grade → becomes claimed by the target.
  - `test_teacher_cannot_use_admin_routes`: 403.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Both are conditional `UPDATE`s on `status`; log `human_grading_released` (with `by`) and `human_grading_reassigned`.
- [ ] **Step 4: Run** `uv run pytest tests/test_grading_admin.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): admins release and reassign grading claims`.

### Task 7: Students see the teacher's grade

**Files:**
- Modify: `core/services/sessions.py` (`get_result`, `_writing_result`), `core/schemas/session.py` (`WritingTask.feedback`)
- Test: `tests/test_session_result.py`

**Interfaces:**
- Consumes: Task 5 `scores` shape.
- Produces:
  - `WritingTask.feedback: str | None = None`. The AI path leaves it null.
  - A teacher grade becomes a `WritingResult`:
    - per task: `band` = task band, `word_count`, and `criteria` in `TASK_CRITERIA` order, each with `band` and `comments = [WritingComment(comment=c, quote=None, suggestion=None, kind=None)]` when it has a comment, else `[]`;
    - `feedback` = the task's feedback;
    - `focus = []`;
    - blank tasks follow `bands.blank_writing_task`.
  - Delete the test skipped in Task 2 (the one that released a held essay).

- [ ] **Step 1: Write failing tests**:
  - `test_teacher_grade_is_the_result`: a requested-manual session is `being_graded` until submit, then `graded`, with `band` 6.5 and per-task feedback and criterion comments. No teacher id or email appears anywhere in the JSON.
  - `test_flagged_session_shows_teacher_grade_not_ai`: a held AI essay graded by a teacher → the result's criteria are the teacher's, and the AI's band never appears.
  - `test_claimed_and_draft_stay_being_graded`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** In `get_result`, for a Writing session:
  1. if a `human_grades` row exists, it is the result: graded only when `status='graded'`;
  2. otherwise use the existing AI path.
  The router's `graded` rule (`writing is not None`) needs no change.
- [ ] **Step 4: Run** `uv run pytest tests/test_session_result.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): result page serves the teacher's Writing grade`.

### Task 8: Docs, glossary and frontend types

**Files:**
- Modify: `ielts-backend/CLAUDE.md`, the spec's status line, `GLOSSARY.md` (root), `ielts-frontend/types/openapi.json`, `ielts-frontend/types/api.ts`

- [ ] **Step 1: Update docs.**
  - **`CLAUDE.md`:**
    - `HumanGrade` origins gain `ai_flagged`;
    - "AI failure" and the AI grading bullets say the hand-off is live;
    - the `held-ai` command is gone and `regrade-ai` skips handed-over sessions;
    - a new "Grading API" line names the `grading` router.
  - **Spec status:** "Writing teacher grading implemented (plan `2026-11-06-teacher-grading-writing.md`); Speaking, admin results/overview and frontend not built".
  - **`GLOSSARY.md` Grading section:** add Teacher grade (`HumanGrade`), Grading queue, Claim, Origin, and Flagged essay.
- [ ] **Step 2: Refresh frontend types.** From `ielts-frontend`, run `npm run api:snapshot && npm run gen:api`, then `npx tsc --noEmit` and `npm test`. Expected: both pass, since `WritingTask.feedback` is optional and nothing else the frontend uses changed.
- [ ] **Step 3: Full check.** From `ielts-backend`, run `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .` and `uv run mypy .`. Expected: all pass.
- [ ] **Step 4: Commit** `docs: teacher grading for Writing; refresh API types`.
