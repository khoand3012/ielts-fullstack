# Glossary

Domain terms shared by `ielts-backend/` and `ielts-frontend/`. Use these names in code, docs and reviews.

## Grading

**Grade** — what a submitted session is scored: `raw_score` (Reading/Listening only, correct answers out of 40) and `band` on `test_sessions`. Students see it on the result page.

**Grade recording** — the backend module (`core/services/grades.py`) that is the only code writing a session's grade:
- **auto score** — marks a Reading/Listening session and stores its score. If marking throws, the session stays unscored and the startup sweep retries it.
- **AI outcome** — moves an AI assessment out of the status it is expected to be in (`processing` when grading finishes). Only a `ready` outcome gives the session its band; `held`, and `failed` while `AI_FAILURE_FALLBACK_TO_TEACHER` is on, hand the session to the grading queue.
- **teacher grade** — writes the claiming teacher's grade and the session's band, once.

**Teacher grade** (`HumanGrade`) — one row per session a teacher grades. It is at once the queue entry, the claim, the private draft and the final grade: `awaiting_grader → claimed → graded`. A submitted grade is final.

**Grading queue** — every teacher grade still `awaiting_grader`, oldest submission first. A test handed over after AI failure keeps the place its submission time gives it.

**Claim** — a teacher taking a test from the queue to grade. Atomic, so no two teachers grade the same test; a teacher holds at most `TEACHER_MAX_ACTIVE_CLAIMS` at once, never their own test. Releasing a claim discards its draft; an admin can release or reassign anyone's claim (a reassigned draft moves with it).

**Origin** — why a test is in the grading queue: `student_request` (the student asked for a teacher), `ai_fallback` (AI grading failed; shown as "AI failed"), `ai_flagged` (a flagged essay) or `speaking`.

**Flagged essay** — a Writing grade the AI finished but held (`held`) because of a manipulation signal. A teacher grades it; they see the AI's draft and the signals, the student never does.

**Marking failure** — marking a Reading/Listening session throws, for example because of a bug in the marking rules or an answer key the code cannot read. It never blocks a submission.

## Writing feedback

**Writing comment** — one piece of AI feedback on a Writing task, filed under one criterion (Task Response/Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy). It has comment text, an optional quote from the essay, an optional suggestion and a kind.

**Comment kind** — `strength` (praises something) or `improvement` (points to a way to improve). Set by grading prompt v2. The backend drops a strength's suggestion.

**Legacy comment** — a Writing comment graded before kinds existed (`kind` is null). It is treated as an improvement. If it has no suggestion, the UI says "No change suggested for these words".

**Highlight** — a marked span of the essay that carries one or more placed comments whose quotes overlap. It is identified by a **highlight key** (`<paragraph>-<index>`). Keys don't change with the criterion filter.

**Placed comment / unplaced comment** — a comment whose quote was found in the essay is placed on a highlight. One with no quote, or whose quote wasn't found, is unplaced and listed under "Other comments on this task".

**Lead comment** — the first comment on a highlight that passes the current criterion filter. It decides the highlight's colour and whether it shows as a strength.

**Display variant** — how a Writing comment is shown, resolved once and used everywhere (the essay panel and Other comments):
- **strength** — "What works", green mark. A suggestion is never shown.
- **fix** — an improvement or legacy comment with a non-blank suggestion. The quoted words are struck out and a "Better" line is shown.
- **mark only** — an improvement with no suggestion. The words are marked in the criterion colour.
- **legacy no change** — a legacy comment with no suggestion. Shown as mark only, plus "No change suggested".

**Writing feedback view model** — the frontend module that turns a `WritingTask`, a criterion filter and a selected highlight key into everything the result screen renders:
- the visible highlights with their lead comments;
- the Previous/Next order and position;
- the placed and unplaced comment groups;
- each comment's display variant and its before / quote / after sentence slices.

Components render what it returns and keep only DOM work (focus, scrolling, the bottom sheet).
