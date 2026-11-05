# Writing feedback: strengths vs improvements — design

Status: draft for approval. Date: 2026-11-05. Owner: Khoa.
Builds on `2026-11-04-results-page-redesign-design.md`. It reverses that doc's non-goal "Writing strengths
(green highlights)", now that the owner wants an explicit field.

## Why

The AI often quotes a student's words to praise them ("integration … is impressive"). The comment has
no field that says it is praise, so the results page draws it like a mistake. In the local data, all 24
of 74 quoted comments without a `suggestion` are praise, but that is a pattern, not a rule. The owner
wants an explicit field, and praise coloured green.

## Goals

- Every new AI comment says what it is: `kind` is `"strength"` or `"improvement"`.
- On the results page, strengths are green everywhere they appear:
  - the essay highlight
  - the coach panel
  - the comment list
  - "Other comments"

  Improvements look as they do today.
- Old results keep working unchanged.

## Non-goals

- Re-grading old results. A `ready` assessment is never changed (AI grading spec §7). Old comments stay
  without `kind`.
- Any change to bands, band descriptors, the number of comments, `focus`, or the injection rules.
- Telling old praise apart by the "no suggestion" pattern. The owner chose the explicit field instead.
- Speaking.

## Data

- **Model output (new prompt version `writing-academic-v2`).** Each comment gains a required
  `kind: "strength" | "improvement"`.
  - A `strength` never carries a `suggestion`. If the model sends one anyway, the parser sets it to null
    and keeps the comment, like the existing quote check.
  - An `improvement` may still have a null `quote` or `suggestion`.
- **Stored and served `WritingComment`.** It gains `kind: "strength" | "improvement" | null`, defaulting to
  null. Null means the comment was graded before v2. Old rows validate unchanged, so no migration is
  needed.
- **Prompt files.** v2 is a copy of v1. The only changes are:
  - rule 4: when to use each kind; a strength quotes the words and has a null suggestion
  - the output format and JSON schema: the `kind` field

  The v1 files stay, because old rows name them. `PROMPT_VERSION` becomes `writing-academic-v2`.

## Results page

- **Colour.** Strengths use the existing `--state-correct` green.
  - Essay highlights use a double underline, so the colour isn't the only signal. The "task" criterion's
    teal is close to green, but its highlights keep a single underline.
  - Their accessible name starts "Strength, ", e.g. "Strength, Lexical Resource: integration".
- **Coach panel.** A strength shows a green box labelled "What works" with a ✓. The quote is marked in
  green, not struck out, and there's no "Better". An improvement looks as it does today.
- **Comment list and "Other comments".** A strength gets a ✓ and the word "Strength" next to it.
- **Comments with null `kind`** (old results) render as today:
  - struck out in red when there is a suggestion
  - neutral with "No change suggested for these words." when there isn't
- **Overlaps.** A highlight takes the kind of the comment that created it. In the panel, each comment
  shows its own kind.
- Criterion bars and the criterion filter are unchanged. Strengths are filtered by their criterion like
  any other comment.
- Hint copy: "Tap a highlight to see the fix" becomes "Tap a highlight to see the feedback".

## Calibration check

v1 is uncalibrated, and there is no teacher-marked set yet. The check is therefore relative:
- Grade the seed essays with `scripts/ai_check.py seed` under v1 and under v2.
- Every criterion band under v2 must be within 0.5 of v1's.
- `scripts/ai_check.py redteam` must pass under v2.

These runs make real model calls on the owner's OpenRouter key, so they need the owner's go-ahead.

## Anti-goals

- Bands drifting upward because the model is now invited to praise.
- Rendering AI text as HTML.
- An old result failing to load.
