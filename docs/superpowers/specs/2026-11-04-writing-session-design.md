# Writing session (frontend) — design

Status: draft for approval. Date: 2026-11-04. Owner: Khoa.

## Intent

Students can already take Reading tests in the web app, and the backend already grades Writing with AI
(and queues it for a teacher on request). The frontend cannot run a Writing test or show Writing
feedback in context. This feature lets a student sit a Writing test and read their feedback, so the
Writing grading work the backend has already done becomes usable.

The student's journey, in the product owner's words: look at the task prompts and type an answer for
each task; submit when the time runs out; the test waits in a pending state until the AI (or a teacher)
has graded it; then the student sees the result, based on IELTS criteria. A later phase adds inline
highlights: spelling/grammar mistakes in red and places to improve in yellow, with a floating
explanation on hover (a tap on phones).

## Phases

**Phase 1 (this design, build now):** the Writing test screen, submit, the pending state, and the
Writing result with bands and comments as the backend returns them today. No highlights.

**Phase 2 (designed here, built later, needs its own plan):** inline red/yellow highlights with the
hover/tap explanation. This needs backend changes and prompt work, so it is deliberately separate.

## Goals (phase 1)

- A student can start a Writing test (practice or exam), write both tasks, and submit.
- Answers autosave and survive a refresh, the same way Reading does. Reopening the session resumes it.
- In exam mode a countdown is shown and the server auto-submits when time is up; the screen reflects that.
- After submitting, the student lands on the existing results page. While the grade is pending it shows
  the "being graded" state and polls; when ready it shows the Writing result (already built).
- (Teacher grading on request is deferred until the backend has a teacher queue; see the calls below.)

## Non-goals (phase 1)

- Inline highlighting of the essay, the feedback list beside the essay, or tap/hover explanations.
- Teacher grading screens (the teacher queue is a separate feature).
- Listening, Speaking, the progress dashboard.
- Any backend change. Phase 1 uses the API as it is.
- Spell-check or grammar help while typing. IELTS is a test; the editor must not assist.

## Anti-goals (would make this a failure even if it works)

- Losing a student's essay: any failure mode that discards typed text is unacceptable. Autosave must
  retry through network loss, and a failed save must be visible.
- Trusting the client for time limits, quotas or grading. The client only reflects what the server says.
- Rendering student or AI text as HTML.
- Giving the student writing assistance (spell-check, autocomplete, paste of prompts is fine).

## What the owner decided

- **Layout:** both tasks on one page, stacked (Task 1 above Task 2), with a sticky countdown at the top.
  Each task shows its prompt (Task 1 includes the chart image), a typing box and a live word count against
  the task minimum (150 / 250 words in the seed test, taken from the content, not hardcoded).
  On phones it is the same single column.
- **Result layout (for phase 2):** essay on the left, a list of every comment on the right; clicking a
  comment jumps to its highlight. On phones it stacks. Hover shows a floating explanation on desktop,
  tapping a highlight slides a card up from the bottom on phones. Red = spelling/grammar mistake,
  yellow = place to improve.
- **Phasing:** highlights are phase 2.

## Calls made by the designer (not yet confirmed by the owner)

- **Practice mode** has no countdown and no auto-submit; the student presses Submit. Exam mode shows the
  countdown. (The backend already works this way: practice has no deadline.)
- **Teacher grading is NOT offered in phase 1 (pending the owner's confirmation).** The backend accepts
  `request_manual_grading` and then marks the session as human-graded, but there is no teacher queue,
  claim or grading endpoint yet (no `HumanGrade` model or teacher routes exist). A student who ticked the
  box would never receive a result. The option and the `PATCH` call are left out until teacher grading
  exists; adding the checkbox later is a small change. This also means an AI grading that fails all
  attempts stays "being graded" for now, because the fallback to a teacher queue does not exist yet.
- **Start flow:** the existing start dialog already has the practice/exam choice and already handles the
  429 quota error with the reset time (`start-test-dialog.tsx`); Writing reuses it unchanged. The reset
  time is shown in the student's local time, as Reading does today.
- **Time running out:** at 0:00 the screen immediately flushes any unsaved text (the server accepts saves
  for 30 seconds after the deadline), then shows the submitted view. If a save is rejected because the
  session is already closed, the typed text stays visible with a message that the text after the last
  save was not stored, and a "Copy my text" button, so the student can keep it. The countdown never
  deletes what is in the box.
- **Long pending grades:** the results page already stops polling after 10 minutes and shows a
  "taking longer than expected, check My sessions" message; phase 1 relies on that and adds no new
  waiting states.
- **Essay length:** the editor stops accepting text beyond 20,000 characters (the backend's default cap)
  and shows a "too long" message, so a huge paste can never cause permanent save failures. If the
  backend cap is changed, this constant must change with it.
- **Submit** is one button for both tasks, behind a confirmation dialog (reuse the Reading submit dialog
  pattern). Submitting with an empty task is allowed; the dialog says which task is empty.
- **After submit** the student is redirected to the result page (reuse the redirect used for Reading).
- **Word count** counts whitespace-separated words. It is advisory only: it does not block submit, and
  it shows amber below the minimum and green at or above it.
- **No paste blocking**, no spell-check (set `spellcheck="false"`, `autocorrect="off"`,
  `autocapitalize="off"`), no resizing handles that hide the count.
- **Quota:** starting a Writing session can return 429 with `extra.resets_at` when the free daily limit
  is used. The start dialog shows a clear message with the reset time. (Check what the Reading start
  flow does today and match it.)
- **Reuse** the existing Reading building blocks rather than rewriting: `Countdown`, `save-queue`,
  `use-session-answers`, `save-status`, `submit-dialog`, the server-clock sync, and the redirect to the
  result page. Add a `WritingScreen` next to `ReadingScreen`, route to it from `session-screen.tsx`, and
  add `writing` to `PLAYABLE_SKILLS`.

## Facts about the backend and existing code (verified by reading)

- Writing test content: `{ tasks: [{ number, prompt, min_words, image|null }] }`. The seed test has two
  tasks; Task 1's `image` is a stored asset path that the API turns into a signed URL in the content it
  returns to students. The frontend Zod schema `WritingContentSchema` in `lib/content/schema.ts` already
  matches this.
- Writing answers are text answers keyed by task number; the backend caps an essay at `MAX_ESSAY_CHARS`
  (20,000 by default) and rejects longer ones with a validation error.
- Time limit for Writing in exam mode is 60 minutes (a setting), with a 30-second grace on saves after
  the deadline. The server auto-submits expired exam sessions.
- Quota: free plan 3 Writing tests per day, consumed when a session starts.
- `GET /sessions/{id}/result` returns `status: being_graded | graded`, and for Writing a `writing` object
  with per-task bands, per-criterion bands, and comments `{ comment, quote|null, suggestion|null }` plus a
  `focus` list. The frontend results page already renders this and already polls while pending.
- The frontend currently gates which skills can be played with `PLAYABLE_SKILLS` (Reading only), and
  `session-screen.tsx` shows "This test type isn't available yet" for anything that is not Reading.

## Phase 2 sketch (for later; not part of the phase 1 plan)

Superseded by `2026-11-04-results-page-redesign-design.md` (criterion colours, quote matching).

To highlight text, the result must tell the frontend where each comment applies and what kind it is.
Today it does not: the result has no essay text, comments carry a free-text `quote` but no position, and
nothing says "mistake" versus "improvement". A phase 2 design will need to decide:

- Whether the AI returns character offsets, or only the quoted phrase that the frontend locates in the
  essay (offsets are exact but models are poor at counting characters; quote matching is fragile when a
  phrase repeats or the model paraphrases).
- A comment `kind` (`mistake` | `improvement`) added to the grading output schema, and a subcategory for
  spelling versus grammar.
- Returning the student's essay text with the result (the essay is stored with the answers).
- Re-checking AI score calibration after any prompt change: the band descriptors in
  `ielts-backend/core/ai/prompts/` are calibrated, and wording changes shift scores.
- What to show for old results that have no `kind` or position (fall back to the phase 1 list).

## Constraints

- Backend OpenAPI is the source of truth. Phase 1 needs no schema change, so no type regeneration is
  expected; if one is needed, run `npm run api:snapshot && npm run gen:api`.
- Follow `ielts-frontend/CLAUDE.md`: server components by default, API only via `lib/api/`, no barrel
  files, Tailwind and shadcn/ui, tests with Vitest, React Testing Library and MSW.
- Accessibility: the editor has a visible label per task, the countdown does not spam screen readers
  (announce at milestones, not every second), save and error states are announced.
- All times are server-enforced; show the server-synced clock, never the device clock alone.

## Left to the builder

- Component structure and file layout inside the existing conventions.
- The exact wording of messages, and visual polish within shadcn/ui.
- Autosave debounce details beyond reusing the Reading save queue.
- Test strategy: cover autosave retry, resume, exam expiry (including a rejected final save), quota error, essay length cap, submit
  confirmation with an empty task, and word-count behaviour.

## Success looks like

A student can sit the seeded Writing test end to end in a browser against the real backend: start, type
both tasks, refresh and find their text intact, submit, see "being graded", and then see their bands and
comments on the results page. Typecheck, lint and tests pass.
