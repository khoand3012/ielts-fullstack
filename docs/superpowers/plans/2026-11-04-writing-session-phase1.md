# Writing Session (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can start a Writing test, type both tasks on one page, submit, and reach the existing results page, without ever losing typed text.

**Architecture:** Add a `WritingScreen` next to `ReadingScreen` and route to it from `session-screen.tsx`. Reuse the Reading building blocks unchanged (`useSessionAnswers`, `Countdown`, `SaveStatus`, `SubmitDialog`, `useSubmitSession`, the redirect in `SubmittedView`). Essay text is stored as a text answer keyed by the task number. No backend changes.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui, TanStack Query, Vitest + React Testing Library + MSW. Work only in `ielts-frontend/`.

**Spec:** `docs/superpowers/specs/2026-11-04-writing-session-design.md`

## Global Constraints

- Layout: both tasks on one page, Task 1 above Task 2, sticky header with the countdown; same single column on phones.
- Word minimums come from `content.tasks[].min_words` (150 / 250 in the seed), never hardcoded. Word count = whitespace-separated words; advisory only (never blocks submit); amber below the minimum, green at or above.
- Essay cap: `MAX_ESSAY_CHARS = 20000` (mirrors the backend default `MAX_ESSAY_CHARS`); the editor never accepts more and says so.
- Editor assists nothing: `spellCheck={false}`, `autoCorrect="off"`, `autoCapitalize="off"`, `autoComplete="off"`. Pasting is allowed.
- Practice mode: no countdown (the session has no `deadline`), manual submit. Exam mode: countdown, and at 0:00 flush unsaved text immediately (the server accepts saves for 30 s after the deadline).
- No teacher-grading option and no `PATCH /sessions/{id}` call in phase 1.
- All API/student text is rendered as plain text (no HTML, no Markdown, no `dangerouslySetInnerHTML`).
- Time limits and quotas stay server-enforced; the client only reflects them. The start dialog (practice/exam, 429 quota message) is reused unchanged.
- Conventions (`ielts-frontend/CLAUDE.md`): RSC by default, `"use client"` only where needed, API only via `lib/api/`, no barrel files, Tailwind + shadcn/ui, tests next to the code.

## Review Focus

- A paste larger than 20,000 characters: text is cut at the cap, a "too long" alert is shown, saves keep succeeding (Task 2).
- An empty or whitespace-only task: counts 0 words, the submit dialog names the empty task, submit is still allowed (Tasks 1, 3).
- Awkward text for the word count: leading/trailing/multiple spaces, newlines, tabs, hyphenated words and non-ASCII letters (Task 1).
- Refresh in the middle of typing: saved text returns from `session.answers`; unsaved text triggers the browser's leave-page warning (already in `useSessionAnswers`) (Task 3).
- The server closes the session (409 `session_closed`) while the student has unsaved text: the text must stay on screen and be copyable (Task 5).
- A test with image `null`, one task, or more than two tasks renders without error (Task 2).

## File Structure

| File | Responsibility |
|---|---|
| `lib/writing/words.ts` (new) | `MAX_ESSAY_CHARS`, `countWords`, `wordCountTone`, `clampEssay` |
| `lib/writing/unsaved.ts` (new) | `unsavedTexts`: which typed texts differ from what the server last stored |
| `components/writing/task-editor.tsx` (new) | One task: prompt, optional image, labelled textarea, word count, too-long alert |
| `components/writing/writing-screen.tsx` (new) | Sticky header, both editors, expiry banner, submit flow |
| `components/session/submit-dialog.tsx` (modify) | Optional `notice` line |
| `components/session/session-screen.tsx` (modify) | Route Writing to `WritingScreen`; hold lost text for `SubmittedView` |
| `components/session/submitted-view.tsx` (modify) | Show unsaved text with copy buttons instead of redirecting |
| `lib/tests/skills.ts` (modify) | Add `writing` to `PLAYABLE_SKILLS` |

---

### Task 1: Word-count and essay-length helpers

**Files:**
- Create: `lib/writing/words.ts`
- Test: `lib/writing/words.test.ts`

**Interfaces:**
- Produces: `MAX_ESSAY_CHARS: 20000`; `countWords(text: string): number`; `wordCountTone(count: number, min: number): "short" | "ok"`; `clampEssay(text: string): { text: string; truncated: boolean }`.

- [ ] **Step 1: Write the failing tests** in `lib/writing/words.test.ts`:
  - `countWords("")` and `countWords("   \n\t ")` are `0`.
  - `countWords("one two  three\nfour\tfive")` is `5`; leading/trailing spaces don't add words.
  - `countWords("well-known état")` is `2` (hyphenated word counts once; non-ASCII letters count).
  - `wordCountTone(149, 150)` is `"short"`; `wordCountTone(150, 150)` is `"ok"`.
  - `clampEssay("a".repeat(20000))` returns the same text with `truncated: false`; `"a".repeat(20001)` returns a 20000-character text with `truncated: true`.
- [ ] **Step 2: Run** `npx vitest run lib/writing/words.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four exports in `lib/writing/words.ts` (split on `/\s+/` after `trim()`; slice by UTF-16 length is acceptable, matching how the backend counts `len(str)` closely enough for a guard).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): writing word-count and length helpers`.

### Task 2: Task editor component

**Files:**
- Create: `components/writing/task-editor.tsx`
- Test: `components/writing/task-editor.test.tsx`

**Interfaces:**
- Consumes: `countWords`, `wordCountTone`, `clampEssay` from Task 1; `WritingContent["tasks"][number]` from `lib/content/schema.ts` (`{ number, prompt, min_words, image? }`).
- Produces: `TaskEditor(props: { task: WritingContent["tasks"][number]; value: string; onChange(value: string): void; readOnly?: boolean })`, a client component.

- [ ] **Step 1: Write the failing tests** (RTL, `userEvent`), in `components/writing/task-editor.test.tsx`:
  - renders a heading "Task 1", the prompt text, and a textbox labelled "Your answer for Task 1".
  - with `image` set, renders an `img` with alt text "Task 1 chart or diagram"; with `image: null` renders no `img`.
  - the textbox has `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"`, `autocomplete="off"`.
  - typing calls `onChange` with the new full text; the count line reads `87 / 150 words` style text, with class/`data-tone="short"` below the minimum and `data-tone="ok"` at or above.
  - pasting 20,001 characters calls `onChange` with exactly 20,000 characters and shows an element with `role="alert"` containing "too long".
  - prompt text containing `<script>alert(1)</script>` appears as text and no `script` element exists in the document.
  - `readOnly` makes the textbox read-only.
- [ ] **Step 2: Run** `npx vitest run components/writing/task-editor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `TaskEditor` in `components/writing/task-editor.tsx` using shadcn `Label`/`Textarea` if present (otherwise a styled `<textarea>`); prompt in a `whitespace-pre-line` block; image as a plain `<img>` (signed URL from the API, so `next/image` is not used); too-long alert is shown after a clamp truncates and clears when the text drops below the cap.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): writing task editor`.

### Task 3: Writing screen and submit flow

**Files:**
- Create: `components/writing/writing-screen.tsx`
- Modify: `components/session/submit-dialog.tsx` (add optional `notice?: string`, rendered as a `<p className="text-sm font-medium">` where the unanswered line is; existing props and tests unchanged)
- Test: `components/writing/writing-screen.test.tsx`; reuse `tests/fixtures/content/writing.json` and `makeSession` from `tests/fixtures/session.ts`

**Interfaces:**
- Consumes: `TaskEditor` (Task 2); `useSessionAnswers(session, { onClosed })` returning `{ answers, setAnswer, flush, status }`; `useSubmitSession(sessionId, flush)`; `Countdown`, `SaveStatus`, `SubmitDialog`; `isAnswered` from `lib/answers/value`.
- Produces: `WritingScreen(props: { session: SessionDetail; content: WritingContent; offsetMs: number; expired: boolean; onExpire(): void; onClosed(): void; onLostText?(text: Record<number, string>): void })`. Task 5 adds the `onLostText` behaviour; in this task accept and ignore it.

- [ ] **Step 1: Write the failing tests** in `components/writing/writing-screen.test.tsx`, following the MSW helper pattern in `components/session/session-screen.test.tsx`:
  - renders both tasks stacked, Task 1 before Task 2, each with its textbox.
  - saved answers (`answers: { "1": "my essay one", "2": "" }`) appear in the right boxes (resume).
  - typing in Task 2 sends `PUT /sessions/s-1/answers` with `{ answers: [{ question: 2, value: "…" }] }` (after the debounce; use fake timers or `waitFor`).
  - practice session (`deadline: null`) shows no countdown; an exam session with a future `deadline` shows one.
  - Submit opens the dialog; with Task 2 empty the dialog contains "Task 2 is empty"; with both filled it shows no such notice; confirming calls `POST /sessions/s-1/submit`.
  - submitting with both tasks empty is still possible and the notice names both ("Task 1 and Task 2 are empty").
  - when `expired` flips true the "Time's up" alert is shown, and the pending text is flushed (a `PUT` is sent without waiting for the debounce).
- [ ] **Step 2: Run** `npx vitest run components/writing/writing-screen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `WritingScreen` by following `components/session/reading-screen.tsx`: same sticky header (title, mode badge, `SaveStatus`, `Countdown` only when `session.deadline`, Submit button), same expired banner, handleExpire = `onExpire(); void flush();`. Body is `content.tasks.map` to `TaskEditor` with `value={typeof answers[task.number] === "string" ? answers[task.number] : ""}` and `onChange={(v) => setAnswer(task.number, v, { debounce: true })}`. Build the dialog `notice` from the tasks whose answers are not `isAnswered`. Add `notice` to `SubmitDialog`.
- [ ] **Step 4: Run** the new test file and `npx vitest run components/session/submit-dialog` (if a test exists) plus `components/session/session-screen.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): writing screen with autosave and submit`.

### Task 4: Route Writing sessions to the new screen

**Files:**
- Modify: `lib/tests/skills.ts` (add `"writing"` to `PLAYABLE_SKILLS`), `components/session/session-screen.tsx`
- Test: `components/session/session-screen.test.tsx` (extend), `components/tests/test-card.test.tsx` (extend)

**Interfaces:**
- Consumes: `WritingScreen` (Task 3), `ParsedContent` discriminated by `skill` from `lib/content/schema.ts`.
- Produces: a Writing session opened at `/sessions/[sessionId]` renders `WritingScreen`; the Writing test card is startable.

- [ ] **Step 1: Write the failing tests:** (a) in `session-screen.test.tsx`, a `makeSession({ skill: "writing", content: writing })` renders both task textboxes and not the "isn't available yet" message; a Speaking session still shows "This test type isn't available yet". (b) in `test-card.test.tsx`, a writing test card shows an enabled Start button, and a speaking one stays disabled.
- [ ] **Step 2: Run** `npx vitest run components/session/session-screen.test.tsx components/tests/test-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement:** add `"writing"` to `PLAYABLE_SKILLS`; in `session-screen.tsx`, replace the `parsed?.skill !== "reading"` guard with a switch: reading renders `ReadingScreen` as today, writing renders `WritingScreen` with the same props, anything else the existing message. Keep the background-refetch alert wrapper around both.
- [ ] **Step 4: Run** the same command plus `npm test`. Expected: PASS, all suites green.
- [ ] **Step 5: Commit** `feat(frontend): play Writing sessions`.

### Task 5: Never lose text when the server closes the session

**Files:**
- Create: `lib/writing/unsaved.ts`
- Modify: `components/writing/writing-screen.tsx` (use `onLostText`), `components/session/session-screen.tsx` (hold `unsavedText` state), `components/session/submitted-view.tsx`
- Test: `lib/writing/unsaved.test.ts`, `components/session/submitted-view.test.tsx` (extend), `components/session/session-screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `AnswerValue` from `lib/answers/value`; `onLostText` slot from Task 3.
- Produces: `unsavedTexts(local: Record<number, AnswerValue>, saved: Record<string, unknown>): Record<number, string>` (non-empty strings in `local` that differ from `saved[String(key)]`); `SubmittedView` gains optional `unsavedText?: Record<number, string>`.

- [ ] **Step 1: Write the failing tests:**
  - `unsavedTexts({1:"a",2:"b"}, {"1":"a"})` is `{2:"b"}`; identical or empty/whitespace-only locals give `{}`.
  - `SubmittedView` with `unsavedText={{2:"my lost essay"}}`: does not call `router.replace`, shows an alert whose text says the last typing was not saved, shows "my lost essay" in a read-only textbox labelled "Task 2 text", and a "Copy Task 2 text" button that calls `navigator.clipboard.writeText("my lost essay")`; a "View result" link is still present. Without `unsavedText` it redirects exactly as before.
  - `SessionScreen` integration: Writing session, the user types text, the PUT is answered with `409 session_closed`, the next `GET` returns a submitted session; the screen ends on the submitted view showing the typed text, and no redirect happened.
- [ ] **Step 2: Run** `npx vitest run lib/writing/unsaved.test.ts components/session/submitted-view.test.tsx components/session/session-screen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement:** `unsavedTexts` in `lib/writing/unsaved.ts`. In `WritingScreen`, wrap `onClosed` so that before calling it, `unsavedTexts(latestAnswers, session.answers)` (read `answers` through a ref so the callback is not stale) is passed to `onLostText` when non-empty. In `SessionScreen`, keep `useState<Record<number,string> | null>` set by `onLostText` and pass it to `SubmittedView` as `unsavedText`. In `SubmittedView`, skip the redirect effect while `unsavedText` is non-empty and render the alert, read-only boxes and copy buttons (plain text only).
- [ ] **Step 4: Run** the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): keep unsaved writing visible when the session closes`.

### Task 6: Verify in a browser and update docs

**Files:**
- Modify: `ielts-frontend/README.md` (status table: Writing session built; results already built), `ielts-frontend/CLAUDE.md` (Key user flows: add the Writing session flow; mark it built)
- No new test files.

**Interfaces:** consumes everything above; produces a verified end-to-end result.

- [ ] **Step 1: Run the full checks** from `ielts-frontend/`: `npm test`, `npx tsc --noEmit`, `npm run lint`. Expected: all pass with no errors.
- [ ] **Step 2: Start the backend** (`docker compose up -d` in `ielts-backend/`, `/health` returns ok) and the frontend (`npm run dev`). Use a separate browser profile and a locally created test account.
- [ ] **Step 3: Walk the golden path** against the seeded Writing test: start in practice mode, type in both tasks, watch the count go amber to green, reload and confirm the text is back, submit with the dialog, land on the result page showing "being graded". Then repeat in exam mode and confirm the countdown shows. Record what you saw; do not claim anything you did not observe. If no `OPENROUTER_API_KEY` is configured, say that grading could not complete and only the pending state was observed.
- [ ] **Step 4: Update the two docs** to match what was actually built and verified.
- [ ] **Step 5: Commit** `docs(frontend): Writing session status and flow`.
