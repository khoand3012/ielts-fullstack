# Frontend handoff — taking tests (backend phase 3)

**Date:** 2026-10-24
**From:** backend session · **To:** frontend session (`../ielts-frontend`, not scaffolded yet)
**Backend branch:** `feat/tests-and-sessions` (PR pending against `main`). Everything below is
implemented and tested there (183 tests), so build against it, not against a guess.
**Backend design (the "why"):** `docs/superpowers/specs/2026-10-24-tests-and-sessions-design.md`

---

## 1. What you can build now

A student can sign in, pick a published test, take it, and submit it. Build these screens:

1. **Auth** — register, login, refresh, logout, "me".
2. **Test list** — published tests, filterable by skill.
3. **Start a test** — choose **practice** or **exam** mode.
4. **Take a Reading / Listening / Writing test** — render the content, autosave answers, show a
   countdown in exam mode, submit, resume after closing the tab.
5. **My sessions** — list of the student's attempts.
6. **"Daily limit reached"** — for Writing (see §6).

## 2. What does NOT exist yet (do not build against it; mock or hide)

| Missing | Why | What to do |
|---|---|---|
| Scores, bands, results, correct answers | Auto-grading and the AI pipeline are later phases | After submit, show only "Submitted". No results page yet. |
| **Speaking** | Needs recording uploads (the Media phase). `POST /sessions` returns **409** for Speaking tests, though they appear in `GET /tests` | Hide Speaking, or show "coming soon". |
| **Listening audio** | No audio files exist. The seed Listening test has `audio: null`, so it **cannot be published** | Build the Listening UI against a locally modified copy (see §8) or a mock. |
| Admin / teacher screens | Human grading and admin test import are later phases | Skip. |
| Progress dashboard | Needs scores | Skip. |

## 3. Run the backend

```bash
docker compose up -d                 # Postgres (MinIO's image could not be pulled on this machine)
uv run alembic upgrade head
uv run uvicorn api.main:app --reload # http://localhost:8000
```

- Swagger: `http://localhost:8000/docs` · schema: `http://localhost:8000/openapi.json`
- Generate types (your convention): `npx openapi-typescript http://localhost:8000/openapi.json -o types/api.ts`
- Local dev data: `practice-01-reading` is **published** in the Compose database. Others need
  loading (§8). To make a user a teacher/admin: `uv run python -m core.cli set-role <email> <role>`.

## 4. API contract

All routes except `/health` and `/auth/register|login|refresh` need `Authorization: Bearer <access>`.
Operation ids are stable (use them for the typed client).

### Auth (already in the schema)

| Route | operation_id | Body → response |
|---|---|---|
| `POST /auth/register` | `auth_register` | `{email, password (8–128)}` → 201 user |
| `POST /auth/login` | `auth_login` | `{email, password}` → `{access_token, refresh_token, token_type}` |
| `POST /auth/refresh` | `auth_refresh` | `{refresh_token}` → new pair. **Refresh tokens rotate on use** — the old one is dead |
| `POST /auth/logout` | `auth_logout` | `{refresh_token}` → 204 |
| `GET /auth/me` | `auth_me` | → `{id, email, plan, role, created_at}` |

Access token lives 15 min, refresh token 30 days.

### Tests

| Route | operation_id | Response |
|---|---|---|
| `GET /tests?skill=&limit=&offset=` | `list_tests` | `{items: [TestSummary], total}` (limit 1–100, default 50) |
| `GET /tests/{test_id}` | `get_test` | `TestSummary`, 404 if unpublished |

`TestSummary = {id, skill, title, exam_time_limit_minutes}` — **no questions**. Content is only
delivered by starting a session (this is deliberate: it is how the daily limit gets enforced).

### Sessions

| Route | operation_id | Notes |
|---|---|---|
| `POST /sessions` | `start_session` | Body `{test_id, mode: "practice"\|"exam"}` → **201 `SessionDetail`**. 404 unpublished, 409 Speaking, **429** over the daily limit |
| `GET /sessions?limit=&offset=` | `list_sessions` | `{items: [SessionRead], total}`, newest first, no content |
| `GET /sessions/{id}` | `get_session` | `SessionDetail` — content + saved answers (this is how you **resume**). Another user's session → 404 |
| `PUT /sessions/{id}/answers` | `save_answers` | Body `{answers: [{question, value}]}` (1–100 items) → `{answers: {…all saved…}}` |
| `PATCH /sessions/{id}` | `update_session` | Writing only. Body `{request_manual_grading: bool}` → `SessionRead` |
| `POST /sessions/{id}/submit` | `submit_session` | → `SessionRead` (submitted) |

```
SessionRead = {
  id, test_id, test_version_id, title, skill, mode, status,   // status: "in_progress" | "submitted"
  started_at, deadline,            // deadline is null in practice mode
  submitted_at, submit_reason,     // "student" | "timeout" | null
  request_manual_grading,          // bool, Writing
  grading_method,                  // "auto" | "ai" | "human" | null — set at submission
  server_time                      // use it to correct the client clock
}
SessionDetail = SessionRead + { content: {…}, answers: { "<questionKey>": value } }
```

JSON object keys are strings, so `answers` keys arrive as `"21"`, not `21`.

## 5. Content shape (what you render)

`content` depends on the skill. Every asset field (`audio`, `image`) is already a **signed URL**
valid for 4 hours (a fresh one on every `GET /sessions/{id}`). `answer_key` and the Listening
transcript are never sent. Full real examples: `seed/tests/practice-01-*.json`.

```
reading   { passages: [{ number, title, paragraphs: [{label|null, text}], question_groups }] }   // 3
listening { parts:    [{ number, title, audio, question_groups }] }                              // 4
writing   { tasks:    [{ number, prompt, min_words, image|null }] }                              // 2; task 1 has the chart
speaking  { part1:{topics:[{topic, questions:[{number,text,audio}]}]}, part2:{…cue_card…}, part3:{…} }   // not startable yet
```

**Question group** — `{type, variant?, instructions, title?, context?, word_limit?, options?, questions}`

- `type`: `multiple_choice | fill_blank | matching | short_answer`
- `options` on the **group** are shared by every item (matching boxes, TRUE/FALSE/NOT GIVEN,
  heading lists). An item may carry its own `options` (multiple choice).
- `context` is summary text with `{8}`-style gap markers; those items have `prompt: null`.
  Replace each `{n}` with an input for question `n`.
- `variant` is a rendering hint only: `true_false_not_given`, `yes_no_not_given`, `headings`,
  `sentence_endings`.
- `instructions` and `word_limit` are text to show as written.

**Question item** — `{numbers: [21, 22], prompt, options?}`

- Most items have one number. "Choose TWO letters" has two (`[21, 22]`) and counts as 2 marks.
- **The item's key is its first number.** Everything is keyed by it: the saved answer, the
  `question` you send. Never send question 22 of a choose-two — it is rejected.
- Show every number in `numbers` as the item's label (e.g. "21–22").

### What to send as `value`

| Item | `value` |
|---|---|
| `multiple_choice` group (**including TRUE/FALSE/NOT GIVEN and a single choice**) | **list** of option keys, e.g. `["B","D"]` or `["TRUE"]`. 1 to `numbers.length` **distinct** keys |
| `matching` group | **one** option key as a string, e.g. `"C"` or `"iii"` |
| `fill_blank`, `short_answer` | string, max 200 chars |
| Writing task | string (essay text), max 20 000 chars; the `question` is the task number `1` or `2` |
| Clear an answer | `null`, `[]`, `""` or whitespace |

Send only the items that changed; each request is validated as a whole, and one bad item rejects
the request (422, nothing saved). The response is the full set of saved answers — use it as the
source of truth.

## 6. Behaviour you must build around

- **Autosave.** Debounce text (~500 ms); send choice changes immediately. Keep a retry queue for
  failures (network drops). Retry on 5xx/network; do not retry 4xx.
- **Resume.** Re-opening a session = `GET /sessions/{id}`; render `content` + `answers`.
- **Exam mode.** `deadline` is set. Show a countdown to `deadline`, correcting the clock with
  `server_time` (`offset = server_time − Date.now()` at response time). **Never gate on your own
  timer** — the server decides.
  - The server accepts saves for **30 s after** the deadline, then submits the session itself.
  - A late save/toggle returns **409 `session_closed`**. Then `GET /sessions/{id}`: it will say
    `status: "submitted"`, `submit_reason: "timeout"`. Show "Time's up — submitted".
  - Even if the student never returns, the server submits within about a minute.
- **Practice mode.** `deadline` is null: no timer, no auto-submit; the student submits when ready.
- **Submit.** `POST …/submit`. A second submit → 409 `session_closed`; treat as "already submitted".
- **Writing toggle.** "Request manual grading" can be switched any time before submitting
  (`PATCH`). It decides at submission whether a teacher or the AI grades it. Nothing visible
  happens yet beyond `grading_method` on the submitted session.
- **Daily limit (Writing and Speaking).** Starting a Writing test — practice **or** exam — uses
  one of today's tests (free plan: 3/day; abandoned tests still count). Over the limit:
  **429**, `error.extra.resets_at` = ISO time (next midnight UTC). Say so before the student
  starts anything; Reading/Listening are unlimited.
- **Exam-only rules are the frontend's job**, not enforced by the server: Listening audio plays
  **once per part** in exam mode (replay allowed in practice). The server only enforces time.

### Errors

Our errors: `{"error": {"code", "message", "extra"}}`.

| Status | code | `extra` |
|---|---|---|
| 401 | `unauthorized` | — (refresh, then retry once) |
| 403 | `forbidden` | — |
| 404 | `not_found` | — (also: someone else's session) |
| 409 | `session_closed` | — (also `conflict`, e.g. Speaking not startable) |
| 422 | `validation_error` | `{question}` — which item was rejected |
| 429 | `quota_exceeded` | `{resets_at}` |

**Caution:** malformed request bodies (wrong types, missing fields) are rejected by FastAPI
itself with its default shape `{"detail": [...]}`, not the format above. Handle both.

## 7. Known gaps and cautions

- **No CORS middleware on the backend.** Fine if you follow your plan (Next.js route handler
  proxy, httpOnly cookies) because the browser only talks to Next. Direct browser → backend
  calls will be blocked until CORS is added — ask the backend session rather than working
  around it.
- **Signed asset URLs** point at R2/MinIO. `<audio>`/`<img>` need no CORS. Locally, MinIO is not
  running (image pull failed), so images/audio will not load until it is fixed. Reading needs no assets.
- **`../ielts-frontend/CLAUDE.md` is stale** in places: it says the backend is at `../backend`
  (it is `../ielts-backend`), that Speaking is AI-graded (teachers grade it), and mentions SSE
  and a backend worker (neither exists; the plan is polling and one in-process app). Fix it when
  you scaffold.
- `/health` returns 200 even when the DB is down.
- Content and answers are keyed by **question number**, not by id.

## 8. Getting test data locally

```bash
uv run python -m core.cli load-test seed/tests/practice-01-reading.json --publish   # already done locally
uv run python -m core.cli load-test seed/tests/practice-01-writing.json --publish   # needs MinIO (uploads the chart)
```

Listening needs audio to publish. To try the UI locally: copy `seed/tests/practice-01-listening.json`
to a scratch file, give each part an `"audio"` key (e.g. `"tests/dev/part1.mp3"`) and add a matching
`"assets"` entry pointing at any small `.mp3`, then `load-test … --publish` (needs MinIO), or mock
the response shape in §4.

`load-test` is also how new content reaches the database until the admin upload exists.

## 9. Suggested order

1. Scaffold Next.js, auth (proxy + cookies), typed client from OpenAPI.
2. Test list → start dialog (mode choice) → Reading session screen (render groups, autosave,
   timer, submit, resume). Reading is the only skill fully playable today.
3. Writing: essay editor with word count against `min_words`, Task 1 chart image, manual-grading
   toggle, the 429 screen.
4. Listening UI (needs audio, §8), including once-per-part playback in exam mode.
5. My sessions list.

When the backend adds scoring, results and Speaking recording, there will be a new handoff.
