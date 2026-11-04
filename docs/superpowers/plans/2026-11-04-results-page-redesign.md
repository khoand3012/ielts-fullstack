# Results Page Redesign (Writing A + Reading/Listening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain results page with a vibrant one. It has a band-ring header, Writing essays with criterion-coloured highlights and a coach panel, and a Reading/Listening question grid with mistake navigation and accuracy by question type.

**Architecture:**
- **Backend:** adds three read-only fields to `GET /sessions/{id}/result`. All are derived when the result is served; nothing is stored or migrated:
  - the essay text per Writing task
  - `section` and `question_type` per Reading/Listening question
  - the passage/part titles
- **Frontend:** refreshes its OpenAPI types and rebuilds `components/result/` around two pure, unit-tested helpers:
  - quote matching (`lib/result/highlights.ts`)
  - question stats (`lib/result/question-stats.ts`)

**Tech Stack:**
- Backend: FastAPI + Pydantic v2 + pytest (Docker).
- Frontend: Next.js 15, TypeScript strict, Tailwind v4, shadcn/ui, TanStack Query, Vitest + RTL + MSW.

**Spec:** `docs/superpowers/specs/2026-11-04-results-page-redesign-design.md`. The prototype is https://claude.ai/artifact/LneXjtCxJmzM9oARdsLLV8 (Direction A and the Reading/Listening tabs); use it for look and feel.

**Branch:** `feat/results-redesign`, cut from `main`. The first commit is the spec plus this plan (`docs: results page redesign design and plan`). All tasks go to one PR, because the backend schema change and the regenerated types must land together.

## Global Constraints

- Bands come only from the server. There are no per-passage bands and no cross-task Writing criterion bands. Criterion bars show the **selected task's** bands, and "by passage/part" shows raw marks such as `9/13`.
- Never render student or AI text as HTML. Highlights are built by slicing strings into React text nodes, never `dangerouslySetInnerHTML`.
- A comment whose quote isn't found must still be visible, under the heading **"Other comments on this task"**.
- Results graded before this change must still render. The stored `AIAssessment.result` JSON shape is unchanged, and the stored `WritingResult`/`WritingTask` models are unchanged.
- Criterion colours:
  - GRA: red
  - LR: violet
  - CC: blue
  - TA/TR: teal
- Skill accents:
  - Writing: fuchsia
  - Reading: blue
  - Listening: violet
  - Speaking: orange (reserved)
- Colour is never the only signal: every highlight has an underline, and its accessible name includes the criterion.
- Light and dark themes (`.dark` class in `app/globals.css`). Phones down to 360px with no sideways scroll. The coach panel is a bottom sheet below `lg`.
- No new runtime dependencies.
- The frontend follows `ielts-frontend/CLAUDE.md`:
  - `"use client"` only where needed
  - API only through `lib/api/`
  - no barrel files
- The backend follows `ielts-backend/CLAUDE.md`: thin routers, async, typed, no `print`.
- Out of scope:
  - Speaking
  - Writing strengths
  - Reading/Listening explanations
  - Listening replay
  - Linking focus items to highlights
  - Directions B and C

## Review Focus

1. **Empty-string quote** (`quote: ""`). `indexOf("")` returns 0, so a naive match would highlight nothing at position 0. It must be treated like `null`, i.e. listed under "Other comments". Test: Task 6.
2. **Windows line endings** (`\r\n\r\n` between paragraphs). The essay must still split into paragraphs, and quotes inside must still match. Test: Task 6.
3. **AI quote with stray outer whitespace** (`" the graph go up "`). Trim before matching, so it still highlights. Test: Task 6.
4. **An unknown `question_type`** from a future content variant (`"diagram_label"`). It shows as "Diagram label", with no crash and no blank label. Test: Task 4.
5. **`questions: []`** (an attempt with no auto-marked items). Show no grid, no crash, and no "Fix these next" strip. Test: Task 5.

---

### Task 1: Backend — question section, type and section titles

**Files:**
- Modify: `ielts-backend/core/services/content.py:41-48`. Add `question_type` to `ItemSpec` and set it in `_rl_spec`. Add `section_titles`.
- Modify: `ielts-backend/core/schemas/session.py`. Add `ResultSection`, two fields on `ResultQuestion`, and `sections` on `SessionResult`.
- Modify: `ielts-backend/core/services/sessions.py:126-154`. `get_result` returns a `ResultData`.
- Modify: `ielts-backend/api/routers/sessions.py:122-177`. `_question` and `_result` read the new fields.
- Test: `ielts-backend/tests/test_session_result.py`

**Interfaces:**
- Produces:
  - `ItemSpec.question_type: str | None = None` (last field). Set to `group.variant or group.type` for Reading/Listening items; `None` otherwise.
  - `section_titles(content: Content) -> list[tuple[int, str]]` in `core/services/content.py`. Returns passages (Reading) or parts (Listening) in order, and `[]` for other skills.
  - `class ResultSection(BaseModel): number: int; title: str` in `core/schemas/session.py`.
  - `ResultQuestion` gains `section: int` and `question_type: str`.
  - `SessionResult.sections: list[ResultSection] | None = None`.
  - `@dataclass(frozen=True) class ResultData` in `core/services/sessions.py`. Fields: `session: TestSession`, `score: auto_grading.Score | None`, `writing: WritingResult | None`, `sections: list[ResultSection] | None`. `get_result` returns it in place of the tuple. `sections` is set only when `score` is set.

- [ ] **Step 1: Write the failing tests.** In `tests/test_session_result.py`:
  - Update the `by[21] == {...}` dict in `test_result_graded_listening` to add `"section": 3, "question_type": "multiple_choice"`.
  - In the same test, assert `body["sections"] == [{"number": n, "title": f"L{n}"} for n in (1, 2, 3, 4)]`.
  - Add `test_result_reading_question_types`. Start a Reading exam with `correct_answers(Skill.READING)`, submit it, then assert:

```python
by = rows(body)
assert (by[1]["section"], by[1]["question_type"]) == (1, "true_false_not_given")
assert (by[8]["section"], by[8]["question_type"]) == (1, "fill_blank")
assert (by[14]["section"], by[14]["question_type"]) == (2, "multiple_choice")
assert (by[27]["section"], by[27]["question_type"]) == (3, "matching")
assert body["sections"] == [{"number": 1, "title": "P1"}, {"number": 2, "title": "P2"}, {"number": 3, "title": "P3"}]
```

  - In `test_result_writing_graded`, add `assert body["sections"] is None`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `uv run pytest tests/test_session_result.py -v` from `ielts-backend/` (Docker must be running).
  Expected: FAIL with `KeyError: 'sections'` or a dict mismatch on `by[21]`.

- [ ] **Step 3: Implement.**
  - Add `ItemSpec.question_type`. In `_rl_spec`, pass it to all three `ItemSpec(...)` calls as a keyword.
  - Add `section_titles`.
  - Add `ResultSection` and the new fields.
  - In `get_result`, load the content once with `catalog.load_content(Skill(ts.skill), version)` and build `sections` from `section_titles` only on the path that returns a `score`.
  - In the router, `_question` reads `item.spec.section` and `item.spec.question_type`. Both are always set for auto-marked items. Narrow them with an explicit `if ... is None: raise ValueError(...)` rather than `cast`, so a broken invariant fails loudly.
  - Update `get_session_result` and the second caller of `get_result`, if any (`grep -rn "get_result(" ielts-backend`), to use `ResultData`.

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run `uv run pytest tests/test_session_result.py tests/test_auto_grading.py tests/test_test_loader.py -v`. Expected: all PASS.

- [ ] **Step 5: Lint, then commit.**
  Run `uv run ruff check . && uv run ruff format --check . && uv run mypy . && uv run pyright`. Expected: no errors.

```bash
git add ielts-backend/core ielts-backend/api ielts-backend/tests/test_session_result.py
git commit -m "feat(backend): result questions carry section and question type; result lists section titles"
```

### Task 2: Backend — essay text on the Writing result

**Files:**
- Modify: `ielts-backend/core/schemas/session.py:107-144`
- Modify: `ielts-backend/core/services/sessions.py`: `get_result` and `_writing_result`
- Modify: `ielts-backend/api/routers/sessions.py`: the `_result` parameter type
- Test: `ielts-backend/tests/test_session_result.py`

**Interfaces:**
- Consumes: `ResultData` from Task 1.
- Produces:
  - `class WritingTaskView(WritingTask): text: str`, the essay as saved, or `""` when blank.
  - `class WritingResultView(BaseModel): tasks: list[WritingTaskView]; focus: list[str]`. Copy `focus`'s `Field(description=...)` from `WritingResult`. Make it a standalone model, not a subclass, to avoid an invariant `list` override.
  - `SessionResult.writing: WritingResultView | None = None`.
  - `ResultData.writing: WritingResultView | None`.
  - OpenAPI schema names `WritingTaskView` and `WritingResultView`. The stored `WritingResult` and `WritingTask` are unchanged and still used by `ai_grading.py`.

- [ ] **Step 1: Write the failing tests.**
  - In `test_result_writing_graded`, add `assert [t["text"] for t in writing["tasks"]] == [ESSAY1, ESSAY2]`. Import them from `tests.test_ai_grading`.
  - In `test_result_practice_blank_task`, add `assert task1["text"] == ""` and `assert task2["text"] == BOTH[2]`.
  - Add `test_result_writing_stored_shape_unchanged`. After grading, read `AIAssessment.result` for the session and assert `all("text" not in t for t in stored["tasks"])`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `uv run pytest tests/test_session_result.py -k writing -v`. Expected: FAIL with `KeyError: 'text'`.

- [ ] **Step 3: Implement.**
  - `_writing_result` still validates the stored JSON as `WritingResult`.
  - `get_result` then calls `get_answers(db, ts)` and builds `WritingResultView`. Each task is `WritingTaskView(**task.model_dump(), text=...)`; use the saved answer when it is a `str`, and `""` otherwise.

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run `uv run pytest -v`. Expected: the whole backend suite PASSes. That includes `test_result_hides_internals`: the response now contains the essays, which must not contain the examiner note.

- [ ] **Step 5: Lint, then commit.**
  Run the lint line from Task 1. Expected: no errors.

```bash
git add ielts-backend/core ielts-backend/api ielts-backend/tests/test_session_result.py
git commit -m "feat(backend): Writing result returns each task's essay text"
```

### Task 3: Contract — refresh types and fixtures

**Files:**
- Modify (generated): `ielts-frontend/types/openapi.json`, `ielts-frontend/types/api.ts`
- Modify: `ielts-frontend/lib/api/types.ts`
- Modify: `ielts-frontend/tests/fixtures/result.ts`

**Interfaces:**
- Produces, in `lib/api/types.ts`:
  - `WritingResult = Schemas["WritingResultView"]`
  - `WritingTask = Schemas["WritingTaskView"]`
  - a new `ResultSection = Schemas["ResultSection"]`

  The other aliases are unchanged. Components keep importing `WritingResult` and `WritingTask`.
- Produces, in `tests/fixtures/result.ts`:
  - `makeResult` questions carry `section: 1` and a `question_type`: Q1 `"true_false_not_given"`, Q8 `"fill_blank"`.
  - The result carries `sections: [{ number: 1, title: "The history of glass" }]`.
  - New `makeWritingResult(overrides?: Partial<SessionResult>): SessionResult`. It holds the result fields from the existing "graded Writing" test (band 6.5, focus `["Vary your sentence openings", "Check article use"]`).
    - **Task 1:** band 6, 172 words, text `"Overall, the graph go up between 2000 and 2020.\n\nThe graph go up again in 2010."`. Its criteria:
      - `task_achievement` 6: "Covers the key trends." with quote `"the graph go up"` and suggestion `"the graph rises"`, and "No overview given." with null quote and suggestion.
      - `lexical_resource` 6.5: no comments.
      - `grammatical_range_accuracy` 6: "Use the past tense for past years." with quote `"The graph go up"` and suggestion `"The graph went up"`.
    - **Task 2:** blank (`band: null`, `word_count: 0`, `criteria: []`, `text: ""`).

- [ ] **Step 1: Regenerate.** From `ielts-frontend/`, run `npm run api:snapshot && npm run gen:api`.
  Expected: `git diff --stat types/` shows both files changed, and `types/api.ts` contains `WritingResultView` and `ResultSection`.

- [ ] **Step 2: Update the aliases and fixtures** as listed in Interfaces. Change the existing inline Writing fixture in `components/result/result-screen.test.tsx` to use `makeWritingResult()`.

- [ ] **Step 2b: Update other inline result literals.** The new fields are required in the regenerated types, so inline `ResultQuestion` and `WritingTask` literals in tests stop typechecking. Find them with `grep -rn "max_marks\|word_count" components lib --include=*.test.ts --include=*.test.tsx`. This covers `result-screen.test.tsx` (for example the Q20–21 item and the script-like-text test) and `lib/result/format.test.ts`.
  - Add `section` and `question_type` to each question literal: Q20–21 gets `section: 2, question_type: "multiple_choice"`.
  - Add `text` to each Writing task literal.

- [ ] **Step 3: Typecheck and test.**
  Run `npx tsc --noEmit && npm test`. Expected: `tsc` is clean, and the existing tests pass. They render the old components, which ignore the new fields.

- [ ] **Step 4: Commit.**

```bash
git add ielts-frontend/types ielts-frontend/lib/api/types.ts ielts-frontend/tests/fixtures/result.ts ielts-frontend/components/result/result-screen.test.tsx
git commit -m "chore(frontend): refresh OpenAPI types for result sections, question types and essay text"
```

### Task 4: Frontend — question stats helpers

**Files:**
- Create: `ielts-frontend/lib/result/question-stats.ts`
- Test: `ielts-frontend/lib/result/question-stats.test.ts`

**Interfaces:**
- Consumes: `ResultQuestion` and `ResultSection` from Task 3; `verdict` and `answerList` from `lib/result/format.ts`.
- Produces:
  - `type ChipState = "correct" | "partial" | "wrong" | "blank"`
  - `chipState(q: ResultQuestion): ChipState`. Returns `"blank"` when `answerList(q.answer)` is empty; otherwise maps `verdict()`: `incorrect` → `"wrong"`.
  - `questionTypeLabel(type: string): string`. Known labels:

    | `question_type` | Label |
    |---|---|
    | `true_false_not_given` | True / False / Not given |
    | `yes_no_not_given` | Yes / No / Not given |
    | `headings` | Matching headings |
    | `sentence_endings` | Sentence endings |
    | `multiple_choice` | Multiple choice |
    | `fill_blank` | Gap fill |
    | `matching` | Matching |
    | `short_answer` | Short answer |

    Any other value: replace `_` with spaces and upper-case the first letter.
  - `type TypeAccuracy = { type: string; label: string; marks: number; max: number; missed: number }`
  - `typeAccuracy(qs: ResultQuestion[]): TypeAccuracy[]`. Sums `marks` and `max_marks` per `question_type`; `missed` counts items whose chip state isn't `correct`. Sorted by `marks / max` ascending, then by `label`.
  - `type SectionMarks = { number: number; title: string; marks: number; max: number }`
  - `sectionMarks(qs: ResultQuestion[], sections: ResultSection[] | null): SectionMarks[]`. Ordered by section number. When a section is missing from `sections`, use `title: ""`.
  - `fixNextForQuestions(qs: ResultQuestion[]): string[]`. The first three `typeAccuracy` rows with `missed > 0`, formatted `` `${label}: ${marks} of ${max} right` ``.

- [ ] **Step 1: Write the failing tests.** Cases:
  - `chipState`:
    - correct
    - partial (choice 1/2)
    - wrong
    - blank for `null`
    - blank for `""`
    - blank for `[]`
  - `questionTypeLabel("true_false_not_given") === "True / False / Not given"`
  - `questionTypeLabel("diagram_label") === "Diagram label"` (Review Focus 4)
  - `typeAccuracy` puts a 1/3 type before a 4/4 type and counts a partial as missed.
  - `sectionMarks` gives `[{number:1,title:"P1",marks:2,max:3},{number:2,title:"",marks:1,max:1}]` when `sections` lacks 2.
  - `fixNextForQuestions` skips types with no misses and returns at most 3 rows.
  - `fixNextForQuestions([])` and `typeAccuracy([])` return `[]` (Review Focus 5).

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `npx vitest run lib/result/question-stats.test.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement** the functions listed in Interfaces.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add ielts-frontend/lib/result/question-stats.ts ielts-frontend/lib/result/question-stats.test.ts
git commit -m "feat(frontend): question chip states, type labels and accuracy helpers"
```

### Task 5: Frontend — theme tokens, band ring, hero header and question grid

**Files:**
- Modify: `ielts-frontend/app/globals.css`. Add tokens to `:root` and `.dark`, and map them in `@theme inline`.
- Modify: `ielts-frontend/lib/result/format.ts`. Add criterion tone and short labels.
- Create: `ielts-frontend/components/result/band-ring.tsx`
- Create: `ielts-frontend/components/result/result-hero.tsx`
- Create: `ielts-frontend/components/result/question-grid.tsx`. This replaces `reading-result.tsx`.
- Delete: `ielts-frontend/components/result/reading-result.tsx`
- Modify: `ielts-frontend/components/result/result-screen.tsx`. `Header` becomes `ResultHero`, and the Body renders `QuestionGrid`.
- Test: `ielts-frontend/components/result/result-screen.test.tsx`

**Interfaces:**
- Consumes: Task 4 helpers; `makeResult` from Task 3.
- Produces:
  - **CSS tokens.** Each is in `:root` and `.dark` and is mapped to a `--color-*` utility:
    - `--skill-reading`, `--skill-listening`, `--skill-writing`, `--skill-speaking`
    - `--crit-task`, `--crit-cc`, `--crit-lr`, `--crit-gra`
    - `--state-correct`, `--state-partial`, `--state-wrong`

    Starting values (OKLCH). Dark mode raises lightness to about 0.72 and keeps the hue.

    | Token | Hue | Light value |
    |---|---|---|
    | gra / wrong | red | `0.58 0.20 25` |
    | lr | violet | `0.55 0.20 295` |
    | cc | blue | `0.55 0.17 250` |
    | task | teal | `0.58 0.12 185` |
    | writing | fuchsia | `0.60 0.22 330` |
    | reading | blue | `0.58 0.17 250` |
    | listening | violet | `0.56 0.20 295` |
    | speaking | orange | `0.68 0.17 55` |
    | correct | green | `0.60 0.15 150` |
    | partial | amber | `0.75 0.15 80` |

    Text on a 15% tint of each must meet 4.5:1 in both themes.
  - In `format.ts`:
    - `type CriterionTone = "task" | "cc" | "lr" | "gra"`
    - `CRITERION_TONE: Record<Criterion, CriterionTone>`
    - `CRITERION_SHORT: Record<Criterion, string>`: TA, TR, CC, LR, GRA
    - `TONE_CLASSES: Record<CriterionTone, { mark: string; dot: string; bar: string }>`. The values are literal Tailwind class strings, so Tailwind can see them.
  - `BandRing({ band, max = 9, accent, label }: { band: number | null; max?: number; accent: Skill; label: string })`. An inline SVG with `role="img"` and `aria-label={label}`. The arc is `band / max`, and the centre text is `formatBand(band)`.
  - `ResultHero({ result, fixNext }: { result: SessionResult; fixNext: string[] })`.
    - Keeps today's skill/module line, `h1`, mode/timeout badges, and the `dl` of stats. The existing `dd` assertions keep passing.
    - Adds a `BandRing` with label `` `Band ${formatBand(band)}` `` (or `"No band"`).
    - Adds a section with heading **"Fix these next"** listing `fixNext`. It is omitted when the list is empty.
  - `QuestionGrid({ questions, sections, skill }: { questions: ResultQuestion[]; sections: ResultSection[] | null; skill: "reading" | "listening" })`. A client component:
    - Group headings: `` `Passage ${n}` `` or `` `Part ${n}` ``, plus the title and `sectionMarks` (e.g. `9/13`).
    - One `button` per item, with its text set to `questionLabel(q.numbers, q.number)` and `aria-label` set to `` `${label}: ${stateText}` ``. `stateText` is one of `Correct`, `Partly correct`, `Incorrect`, `No answer`.
    - A toggle group with **"All"** and **"Mistakes only"**.
    - A type `<select>` labelled **"Question type"**, with "All types" plus each `questionTypeLabel`.
    - A detail card for the selected item. It shows "Your answer" (the existing `StudentAnswer` logic, moved here), "Correct answer" (the existing `Accepted` logic), marks, and the type label. It has **"Previous mistake"** and **"Next mistake"** buttons, which skip correct items in number order.
    - An **"Accuracy by question type"** list of bars from `typeAccuracy`.
    - `questions.length === 0` renders nothing.
  - `result-screen.tsx` computes `fixNext`:
    - Writing: `result.writing.focus.slice(0, 3)`
    - Reading/Listening: `fixNextForQuestions(result.questions)`
    - otherwise: `[]`

- [ ] **Step 1: Rewrite the Reading test and add new ones** in `result-screen.test.tsx`. Replace "graded Reading shows the score header and every question" with:
  - **"graded Reading shows the hero and a chip per item"**
    - Keep the existing `1/2` (dd) and `30 min 0 s` assertions.
    - Change the band assertion to `getByText("5.5", { selector: "dd" })`. The ring also renders `5.5` in an SVG `<text>`, so an unscoped `getByText` would find two elements.
    - Assert `getByRole("img", { name: "Band 5.5" })`.
    - Assert buttons named `Q1: Correct`, `Q8: Incorrect` and `Q20–21: Partly correct`.
    - Assert the heading `Passage 1` and the text "The history of glass".
  - **"selecting a chip shows the answers; next mistake skips correct items"**
    - Click `Q1: Correct`, then expect "TRUE" within the detail card. Scope with `within(card)`, where the card is a `region` labelled "Question detail". "TRUE" appears as both answers.
    - Click "Next mistake", then expect "moss" and "lichen / lichens".
    - Click "Next mistake" again, then expect `(right)` and `(wrong)` and "A, B" for Q20–21.
  - **"mistakes only hides correct chips"**: after the toggle, `queryByRole("button", { name: "Q1: Correct" })` is null.
  - **"type filter keeps only that type"**: choose "Gap fill", and only Q8's chip remains.
  - **"fix these next lists weakest types"**: the text "Gap fill: 0 of 1 right" is present.
  - **"Listening groups by part"**: `makeResult({ skill: "listening", module: null, sections: [{ number: 1, title: "Booking a room" }] })`. Expect the heading `Part 1` and the text "Booking a room". This is fixture-only; the Listening session isn't playable yet.
  - **"empty questions renders no grid"**: `makeResult({ questions: [] })`; there is no "Accuracy by question type" and no "Fix these next" (Review Focus 5).
  - Keep "script-like text in answers and comments renders as text". If needed, open the chip whose answer contains the script string before asserting.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `npx vitest run components/result/result-screen.test.tsx`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the tokens, `format.ts` additions, `BandRing`, `ResultHero`, `QuestionGrid` and the `result-screen.tsx` wiring, then delete `reading-result.tsx`. Layout and look follow the prototype's Reading tab:
  - hero card with the ring on the left
  - chips in a wrapping grid per section
  - a 4-column chip grid on phones, sized for touch (at least 40px)

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run `npx vitest run components/result && npx tsc --noEmit && npm run lint`. Expected: PASS and clean.

- [ ] **Step 5: Commit.**

```bash
git add ielts-frontend/app/globals.css ielts-frontend/lib/result/format.ts ielts-frontend/components/result
git commit -m "feat(frontend): results hero with band ring and Reading/Listening question grid"
```

### Task 6: Frontend — quote matching

**Files:**
- Create: `ielts-frontend/lib/result/highlights.ts`
- Test: `ielts-frontend/lib/result/highlights.test.ts`

**Interfaces:**
- Consumes: `Criterion` from `lib/api/types`.
- Produces:
  - `type FeedbackComment = { id: string; criterion: Criterion; comment: string; quote: string | null; suggestion: string | null }`. `id` is assigned by the caller as `` `${criterion}-${index}` ``.
  - `type Highlight = { start: number; end: number; commentIds: string[] }`. Offsets are into the **original** paragraph text, with `end` exclusive.
  - `type EssayParagraph = { text: string; highlights: Highlight[] }`. Highlights are sorted by `start` and never overlap.
  - `type PlacedEssay = { paragraphs: EssayParagraph[]; unplaced: string[] }`. `unplaced` holds comment ids in API order.
  - `placeComments(essay: string, comments: FeedbackComment[]): PlacedEssay`
  - `sentenceAround(text: string, start: number, end: number): { start: number; end: number }`. Widens to the enclosing sentence:
    - Backwards: to just after the previous `.`, `!` or `?`, then skip leading whitespace. Stop at the paragraph start if there is none.
    - Forwards: through the next `.`, `!` or `?`, or to the paragraph end.

- [ ] **Step 1: Write the failing tests.** Each test asserts `p.text.slice(h.start, h.end)` equals the expected original substring.
  1. **Exact match:** `"The graph go up."` with quote `"graph go up"` gives one highlight at 4–15.
  2. **Case fallback:** quote `"the graph"` against `"The graph rose."` gives a highlight on `"The graph"`.
  3. **Normalisation:**
     - essay `"It’s  clear"` (curly apostrophe, two spaces) with quote `"It's clear"` highlights `"It’s  clear"`
     - essay `"2000–2020"` with quote `"2000-2020"` matches
  4. **Repeats:** two comments, both quoting `"go up"`, in `"go up and go up"`. They give two highlights, 0–5 and 10–15.
  5. **Overlap:** `"very big increase"` and `"big increase"` give one highlight with both ids.
  6. **Not found, null and empty quotes:** quote `"nothing"`, quote `null` and quote `""` are all in `unplaced` (Review Focus 1).
  7. **Cross-paragraph:** essay `"End one.\n\nStart two."` with quote `"one. Start"` is in `unplaced`.
  8. **Line endings:** essay `"Para one.\r\n\r\nPara two goes up."` gives 2 paragraphs, and quote `"goes up"` highlights in paragraph 2 (Review Focus 2).
  9. **Trim:** quote `" goes up "` matches `"goes up"` (Review Focus 3).
  10. **Empty essay:** `""` gives `paragraphs: []` and every comment in `unplaced`.
  11. **`sentenceAround`:** `("A one. B two here. C.", 9, 12)` returns the range of `"B two here."`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `npx vitest run lib/result/highlights.test.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `placeComments`.** The tests don't fix the algorithm, so follow this one:

```text
paragraphs = essay split on /\r?\n\s*\r?\n/, each trimmed of trailing \r, empty ones dropped
for each paragraph build (norm: string, map: number[]) where map[i] = original index of norm[i]:
  - curly ‘ ’ → ', “ ” → ", en/em dash → -, any whitespace run → one " " (map points at the run's first char)
  - also keep lower = norm.toLowerCase() char-by-char (same length, same map)
used = Map<normalisedQuote, Set<"p:start">>   // occurrences already taken per quote text
for each comment in order:
  q = normalise(comment.quote?.trim() ?? ""); if q === "" → unplaced; continue
  find the first (paragraph, index) where norm.indexOf(q, from) hits and "p:index" not in used[q];
    if none, repeat the search on lower with q.toLowerCase(); if none → unplaced; continue
  origStart = map[index]; origEnd = map[index + q.length - 1] + 1
  mark used; if [origStart, origEnd) overlaps an existing highlight in that paragraph,
    push comment.id onto that highlight's commentIds; else insert a new highlight (keep sorted)
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add ielts-frontend/lib/result/highlights.ts ielts-frontend/lib/result/highlights.test.ts
git commit -m "feat(frontend): place Writing feedback quotes in the essay"
```

### Task 7: Frontend — Writing view with highlighted essay and coach panel

**Files:**
- Create: `ielts-frontend/components/result/criterion-bars.tsx`
- Create: `ielts-frontend/components/result/highlighted-essay.tsx`
- Create: `ielts-frontend/components/result/coach-panel.tsx`
- Modify (rewrite): `ielts-frontend/components/result/writing-result.tsx`
- Test: `ielts-frontend/components/result/result-screen.test.tsx`

**Interfaces:**
- Consumes:
  - `placeComments`, `sentenceAround` and `FeedbackComment` (Task 6)
  - `CRITERION_TONE`, `TONE_CLASSES`, `CRITERION_SHORT` and `CRITERION_LABELS` (Task 5 and existing)
  - `WritingResult` and `WritingTask` (Task 3)
- Produces:
  - `CriterionBars({ criteria, active, onToggle }: { criteria: WritingCriterion[]; active: Criterion | null; onToggle(c: Criterion): void })`. One `button` per criterion with `aria-pressed`. It shows the short label, full label, band, and a bar of `band / 9` in the tone colour.
  - `HighlightedEssay({ placed, comments, filter, selectedId, onSelect })`. Renders paragraphs as `<p>`. Each highlight is an inline `<button type="button">` with the tone underline and tint (the first comment's criterion picks the tone).
    - Its accessible name is `` `${CRITERION_LABELS[c]}: ${slice}` ``. Use a visually-hidden prefix span, not `aria-label`, so the visible text stays the name.
    - A highlight whose comments all fail the `filter` renders as plain text.
  - `CoachPanel({ task, placed, comments, selectedId, order, onSelect, onClose })`. `order` is the highlight comment ids in essay order, after the filter.
    - **With a selection**, for each comment on the selected highlight:
      - **"You wrote"**: the `sentenceAround` text, with the quote in a `<mark>`.
      - **"Better"**: the same sentence with the quote swapped for `suggestion`. Omit it when `suggestion` is null or empty.
      - The comment text, with the criterion chip.
      - **"Previous"** and **"Next"** buttons, which walk `order`, and **"Close"**.
    - **With no selection**: the hint "Tap a highlight to see the fix". Then every comment of the task grouped by criterion; clicking a placed one selects it. Then **"Other comments on this task"** lists the `unplaced` ones.
    - **"Better" sentence:** render it as one plain string (sentence prefix + suggestion + suffix), with no inner elements, so it reads and tests as a single sentence.
    - **Focus:** selecting a highlight moves focus to the panel's heading (`tabIndex={-1}`). Close returns focus to the highlight button that opened it. Escape closes the sheet.
    - **Layout:** `lg:` and up, a sticky aside beside the essay. Below `lg`, when there is a selection, a `fixed inset-x-0 bottom-0` sheet with `max-h-[60vh] overflow-auto` and a Close button. With no selection on phones, the list renders inline under the essay.
  - `WritingResultView({ writing }: { writing: WritingResult })`:
    - A task switch (shadcn `Tabs`) with tabs labelled `` `Task ${n} · ${formatBand(band)}` `` and the word count.
    - `CriterionBars` for the selected task, then the essay and the panel.
    - **Blank practice task** (`band === null`): "Not graded: no answer", with no bars.
    - **Blank exam task** (`text === ""` and band set): the bars, then "No answer" in place of the essay.
    - Selecting a criterion filters highlights and the panel list; clicking the active criterion clears it. Switching task clears the selection and the filter.

- [ ] **Step 1: Rewrite the Writing test and add new ones** in `result-screen.test.tsx`, using `makeWritingResult()`. Replace "graded Writing shows bands, comments, a blank task and the focus list" with:
  - **"graded Writing shows the essay with highlights"**
    - Assert the tab "Task 1 · 6.0" and the essay text, using a regex: `getByText(/between 2000 and 2020/)`. The paragraph is split by the highlight button.
    - Assert buttons named `Task Achievement: the graph go up` (paragraph 1) and `Grammatical Range and Accuracy: The graph go up` (paragraph 2).
    - Assert "Fix these next" lists "Vary your sentence openings".
  - **"tapping a highlight opens the coach panel"**
    - Click the Task Achievement highlight, then expect "You wrote", "Better", the sentence `"Overall, the graph rises between 2000 and 2020."` and "Covers the key trends.".
    - Click "Next", then expect "Use the past tense for past years.".
    - Click "Close", then "Tap a highlight to see the fix" shows.
  - **"criterion filter hides other highlights"**: click the `Grammatical Range and Accuracy` bar. Then `queryAllByRole("button", { name: /^Task Achievement:/ })` has length 0, and the GRA highlight button is still present.
  - **"blank exam task"**: `makeWritingResult` with Task 2 overridden to `band: 0, text: ""` and four criteria at band 0 with no comments. On the "Task 2" tab, "No answer" is present.
  - **"unplaced comments are listed"**: the heading "Other comments on this task" contains "No overview given.".
  - **"blank practice task"**: click the tab "Task 2", then "Not graded: no answer" is present.
  - Update "script-like text…": an essay `text` containing `<script>alert(1)</script>` renders as text, and `document.querySelector("script")` is null.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `npx vitest run components/result/result-screen.test.tsx`. Expected: the new Writing tests FAIL.

- [ ] **Step 3: Implement** the four components. Build `FeedbackComment[]` per task by flattening `criteria[].comments[]` with ids `` `${criterion}-${i}` ``.

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run `npx vitest run components/result && npx tsc --noEmit && npm run lint`. Expected: PASS and clean.

- [ ] **Step 5: Commit.**

```bash
git add ielts-frontend/components/result
git commit -m "feat(frontend): Writing result with highlighted essay and coach panel"
```

### Task 8: Frontend — under-length warning on the task switch

**Files:**
- Modify: `ielts-frontend/components/result/writing-result.tsx`
- Modify: `ielts-frontend/components/result/result-screen.tsx`. Pass `sessionId` to `WritingResultView`.
- Test: `ielts-frontend/components/result/result-screen.test.tsx`

**Interfaces:**
- Consumes:
  - `useSessionQuery(id)` from `lib/session/queries.ts`
  - `parseContent` and `ContentError` from `lib/content/schema.ts`
- Produces: `WritingResultView({ writing, sessionId })`. It reads `min_words` per task from the session's content. When `word_count > 0 && word_count < min_words`, the tab shows a warning chip `` `Under ${min_words} words` ``. If the query is loading, fails, or the content doesn't parse, there is no chip and no error UI. Wrap `parseContent` in try/catch.

- [ ] **Step 1: Write the failing tests.**
  - First, extend the file's `serve` helper so it also answers `GET /sessions/s-1` with a 404 by default. Otherwise every existing Writing test makes an unhandled request; MSW's default is to warn, and the noise hides real problems. The chip tests below override it with `server.use`.
  - **"under-length task shows a warning chip"**: MSW serves `GET /sessions/s-1` with Writing content (`min_words` 150/250) from `tests/fixtures/session.ts`, with Task 1 `word_count: 120`. Expect the text "Under 150 words".
  - **"no chip when session content fails to load"**: `GET /sessions/s-1` returns 500. The Writing view still renders, and `queryByText(/Under \d+ words/)` is null.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run `npx vitest run components/result/result-screen.test.tsx -t "chip"`. Expected: FAIL.

- [ ] **Step 3: Implement** as described in Interfaces.

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run `npx vitest run components/result && npx tsc --noEmit && npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add ielts-frontend/components/result
git commit -m "feat(frontend): warn on Writing tasks under the minimum word count"
```

### Task 9: Docs, full verification, PR

**Files:**
- Modify: `ielts-frontend/CLAUDE.md`. Rewrite key-flow item 5 (Results page) to describe the hero, the Writing highlights with coach panel, and the Reading/Listening grid. Say that Speaking results are still not built.
- Modify: `docs/superpowers/specs/2026-11-04-writing-session-design.md`. Add one line under "Phase 2 sketch": "Superseded by `2026-11-04-results-page-redesign-design.md` (criterion colours, quote matching)."

- [ ] **Step 1: Run the full backend suite.**
  From `ielts-backend/`, run `uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy . && uv run pyright`. Expected: all pass. Record the real output.

- [ ] **Step 2: Run the full frontend suite.**
  From `ielts-frontend/`, run `npm test && npx tsc --noEmit && npm run lint`. Expected: all pass.

- [ ] **Step 3: Check against the real backend.**
  1. Start Postgres, the API and `npm run dev`.
  2. Log in as a seeded student, take the seed Reading test with a few wrong answers, and submit.
  3. Take the seed Writing test with an AI key configured, or reuse a graded session.
  4. On both result pages, check the following in light and dark, and at 375px wide:
     - no console errors
     - highlights open the panel
     - the bottom sheet works on a phone
     - no page-level horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`)

- [ ] **Step 4: Commit the docs. Ask the user before pushing and opening the PR**; approving this plan does not approve the push.
  Title: "Results page redesign: Writing highlights and Reading/Listening grid". The body lists the API additions and links the spec.

```bash
git add ielts-frontend/CLAUDE.md docs/superpowers/specs/2026-11-04-writing-session-design.md
git commit -m "docs: results page redesign status"
```
