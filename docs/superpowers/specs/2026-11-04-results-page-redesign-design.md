# Results page redesign (Writing + Reading/Listening) — design

Status: draft for approval. Date: 2026-11-04. Owner: Khoa.
Prototype: https://claude.ai/artifact/LneXjtCxJmzM9oARdsLLV8 (private; mock data). This doc builds
**Direction A** for Writing and the Reading/Listening view from that prototype.

## Intent

The results page (`ielts-frontend/components/result/`) is hard to read. Reading is a plain table.
Writing feedback is a stack of text cards per criterion, with each quote shown away from the essay,
so a student can't see *where* in their own writing a problem is. The owner wants the page to be more
vibrant and interactive, and above all to show students their own answer with the mistakes marked
and a better version beside each one.

Success: a student opens a graded Writing result and reads their essay with coloured highlights. A tap
on a highlight shows what they wrote, a better version and why. A Reading student sees at a glance
which questions they missed and which question types are weakest, and can step through only the
mistakes.

## Scope and order (owner's decisions)

1. **This design:** a shared results header, Writing Direction A and the Reading/Listening question grid.
2. **Later, separate design:** Speaking Direction A (transcript with teacher marks and an audio jump).
   It is blocked until Speaking test-taking (recording and upload), the teacher grading queue and
   auto-transcription exist. None of these exist today. The prototype's Speaking data needs (a timed
   transcript, teacher annotations with span, criterion, better version and why) are input to that
   design, not this one.

Directions B (line by line) and C (coach view) from the prototype are not built.

## Goals

- **Shared header (all skills):** the skill-coloured band ring, title and mode/time chips, the
  key stats, and a "Fix these next" strip.
- **Writing:** a Task 1 / Task 2 switch. Each task shows its band and four criterion bars, then the
  student's essay with inline highlights coloured **by criterion**. Tapping a highlight opens a coach
  panel showing the original sentence, a "Better" version with the suggestion swapped in, and the
  comment. The panel has Prev/Next. Tapping a criterion bar or chip filters the highlights to that
  criterion. Comments that can't be placed in the essay still appear in the panel's list.
- **Reading/Listening:** a grid with one chip per scored item, coloured correct / partly correct /
  wrong / blank, grouped by passage (Reading) or part (Listening). It has an "All / Mistakes only"
  filter, a question-type filter, and a detail card (your answer vs accepted answers) with
  "Next mistake" / "Previous mistake". It also shows marks per passage/part and accuracy by question
  type, weakest first.
- Light and dark themes, and phone widths down to 360px with no sideways scroll. On phones the coach
  panel is a bottom sheet.
- Everything is keyboard-reachable, and screen readers can tell what each highlight is.

## Non-goals (things the prototype showed that this build does not do)

- **Speaking** in any form (see Scope).
- **Writing strengths (green highlights).** The grading prompt only asks for a `quote` paired with a
  `suggestion` (`ielts-backend/core/ai/prompts/writing_academic_v1.md` rule 4) and never asks for praise.
  There is also no field that tells praise apart from a problem. Adding one means a prompt change and
  a re-check of band calibration, so it is out.
- **Reading/Listening explanations or notes** under the answer: the test content has none.
- **Listening "Replay this part"** and per-question clip times: there are no timings.
- **Linking "Fix these next" items to highlights.** `focus` items are free text with no reference to a
  comment.
- **Bands the server didn't give.** No per-passage bands and no cross-task Writing criterion bands
  (see Rules).
- The audio player, heatmap, pattern cards and diff views from the prototype.
- Any change to grading, the AI prompt or scoring.

## Anti-goals

- Rendering student or AI text as HTML. Highlights are built by slicing the essay string into React
  text nodes; never `dangerouslySetInnerHTML`.
- Computing or inventing a score or band in the browser.
- Hiding feedback: a comment whose quote isn't found in the essay must still be visible.
- Breaking old results. Results graded before this change must render with no backfill.

## Rules

- **Bands come only from the server.** The Writing hero ring shows the overall `band`. The criterion
  bars show the selected task's criterion bands and follow the Task 1/2 switch. Reading "by passage"
  shows raw marks (e.g. `9/13`), never a band.
- **Criterion colours.** Grammar (GRA) red, vocabulary (LR) violet, coherence (CC) blue, task (TA/TR)
  teal. These are the prototype's tokens, adapted to the app's theme, with good contrast in both
  themes. Colour is never the only signal: every highlight also has an underline style, and its
  accessible label names the criterion.
- **Skill accents.** Writing fuchsia, Reading blue, Listening violet (Speaking orange, reserved).

## Data: what changes in the API

The backend OpenAPI schema stays the source of truth. The backend change and the regenerated
`ielts-frontend/types/` land in **one PR** (root `CLAUDE.md`).

### Writing: return the essay

Add the student's text to each task in the result **on the response side only**:

- `WritingTask` in the response gains `text: str`, the essay as saved, `""` if blank. It is filled
  from the session's saved answers (keyed by task number) when the result is served.
- The stored assessment JSON is **not** changed, and the model used to validate it stays as is. If
  the stored model gained a required field, every existing assessment row would fail to validate. So
  the builder uses a separate response model, or sets the field after validation; see "Left to the
  builder".
- Old results therefore gain essay text automatically, with no migration.
- No `kind` field, no offsets and no prompt change (see the decisions below).

### Reading/Listening: question type and section

`ResultQuestion` gains:

- `section: int`, the passage number (Reading) or part number (Listening) the item belongs to.
- `question_type: str`, the question group's `variant` when set (`true_false_not_given`,
  `yes_no_not_given`, `headings`, `sentence_endings`), otherwise its `type` (`multiple_choice`,
  `fill_blank`, `matching`, `short_answer`).

`SessionResult` gains `sections: list[{number: int, title: str}] | None`, the passage or part titles
for the grid's group headings. It is null for Writing.

All three come from the test version's content, which `get_result` already loads to recompute marks.
They need no storage change. The frontend maps `question_type` values to labels
(e.g. "True / False / Not given") and falls back to a title-cased value for unknown ones.

## Decisions that answer the 4 Nov Writing design's "phase 2" questions

That doc (`docs/superpowers/specs/2026-11-04-writing-session-design.md`) planned red/yellow highlights
by kind. **The owner has replaced that with colouring by criterion.** Its open questions are settled
as follows:

- **Position:** the frontend matches the comment's `quote` in the essay. There are no offsets. The
  prompt already requires quotes to be exact.
- **Kind:** none. Criterion is the colour; mistake vs improvement is not shown.
- **Prompt and calibration:** unchanged, so no calibration re-check.
- **Old results:** they work as they are, because the essay is already in the saved answers.
- **Layout:** stays as that doc described it: essay with a comment panel beside it on desktop, a
  bottom sheet on phones. Tapping a comment in the list jumps to its highlight.

## Quote matching (Writing)

A pure, unit-tested function maps `(essay, comments[])` to highlight ranges plus a list of comments
it couldn't place:

1. **Normalise for comparison only.** Collapse runs of whitespace, and treat curly and straight quotes
   and apostrophes, and en/em dashes and hyphens, as the same. Keep a map from normalised positions
   back to the original essay so the highlight covers the original characters exactly.
2. **Exact, case-sensitive match first.** If that fails, retry case-insensitive. No fuzzy matching.
3. **Repeated phrases.** A quote that occurs more than once maps to the first occurrence not already
   used by another comment with the same quote. Comments are processed in API order.
4. **Overlaps.** If a new range overlaps one already placed, it is not drawn as a second highlight.
   The comment is attached to the existing highlight instead, and the panel shows both comments, each
   with its own criterion colour. (Nested marks are hard to tap and hard to read.)
5. **Not placed.** These comments are listed in the panel under "Other comments on this task", with no
   jump target:
   - quotes that cross a paragraph break and can't be matched across it
   - quotes not found at all
   - comments with `quote: null`
6. **Essay rendering.** Split the essay on blank lines into paragraphs. Highlights are spans inside
   the paragraph text. Line breaks inside a paragraph are kept.

The "Better" line replaces the quote with `suggestion` inside its sentence. If there is no suggestion,
the panel shows the comment only.

## Reading/Listening grid details

- **One chip per scored item.** A choose-two item covering Q21–22 is a single chip labelled "21–22"
  (using `questionLabel`), because correctness per number isn't knowable for choice items.
- **Chip states** come from the existing `verdict()`, plus a blank state when `answerList(answer)` is
  empty. That makes four states: correct, partly correct, wrong, blank.
- **Detail card:** the student's answer (choice picks marked right/wrong with `correct_choices`, as
  today), the accepted answers, marks, and the type label.
- **"Fix these next" for Reading/Listening:** the three question types with the lowest accuracy that
  have at least one miss, phrased as a count ("Headings: 2 of 5 right"). This is a count only, not a
  band.
- **Listening.** It shares the Reading component. Listening sessions can't be played in the frontend
  yet, so for now the Listening view is checked with fixtures only. This is a known gap.

## Writing view details

- The hero "Fix these next" strip shows the first three `focus` items, as plain text.
- The task switch shows each task's band and word count. Task 1 under its `min_words` gets a warning
  chip. `min_words` comes from the test content; if the result page doesn't have it, use the content
  endpoint or leave the chip out. The builder decides; do not hardcode 150/250.
- **Blank practice task** (`band: null`): the task is shown with "Not graded: no answer", with no
  essay and no bars.
- **Blank exam task** (band 0, empty comments): the essay area says "No answer".
- The comment panel's empty state ("Tap a highlight") lists all of the task's comments, so the panel
  is also the full comment list (the 4 Nov layout).

## States kept from today

`result-screen.tsx` behaviour is unchanged: being_graded polling, the 10-minute timeout message, the
409 redirect, 404, the error/retry banner and the live status region. Only the graded body and header
change.

## Constraints

- Follow `ielts-frontend/CLAUDE.md`:
  - RSC by default; `"use client"` only where needed (the grid and essay are interactive).
  - API only through `lib/api/`; no barrel files.
  - Tailwind utilities and shadcn/ui; colour tokens in `globals.css` with dark-mode values.
  - Vitest + RTL + MSW.
- Follow `ielts-backend/CLAUDE.md`: thin router, schema in `core/schemas/session.py`, tests with pytest.
- After the backend change, run `npm run api:snapshot && npm run gen:api` from `ielts-frontend`.
- No new runtime dependencies are expected. The band ring is a small inline SVG.

## Left to the builder

- Component structure and file names inside `components/result/`, and how to split client and server
  components.
- How the response-side essay text is attached in the backend:
  - a response model that extends the stored one, or
  - building the response from the stored model plus answers.

  Either way, the stored validation must not change.
- Exact copy, spacing, animation and the visual polish of the ring and chips, within the prototype's
  look.
- Whether `min_words` is fetched for the under-length chip or the chip is dropped.
- Test strategy. At minimum cover:
  - quote matching: exact, case fallback, normalisation, repeats, overlaps, not found, null quote,
    cross-paragraph
  - chip states, including partly correct and blank
  - the mistakes-only and type filters
  - an old result without `section` / `question_type` while types are mid-rollout (should not happen
    after one PR, but the UI must not crash)
  - the backend tests for the new fields

## Success looks like

Against the real backend with the seed tests:

- A graded Writing session shows both essays with criterion-coloured highlights.
- Tapping one shows the coach panel; Prev/Next and the criterion filter work.
- Unplaced comments are listed.
- A Reading session shows the grid with passage groups, type accuracy and mistake navigation.
- Both themes and a 375px phone look right.
- Backend `pytest`, ruff, mypy and pyright pass. Frontend tests, `tsc` and lint pass.
