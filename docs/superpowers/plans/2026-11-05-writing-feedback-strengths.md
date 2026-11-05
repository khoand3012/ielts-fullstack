# Writing feedback strengths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI Writing comments say whether they are a strength or an improvement, and the results page colours strengths green.

**Architecture:**
- A new prompt version (`writing-academic-v2`) makes the model return a `kind` per comment. The parser enforces "a strength has no suggestion".
- The stored and served `WritingComment` gains an optional `kind`, where null means graded before v2.
- The frontend reads `kind` to style highlights, the coach panel and the lists.

**Tech Stack:** FastAPI, Pydantic v2, pytest (`ielts-backend`); Next 15, TypeScript, Tailwind v4, Vitest + RTL + MSW (`ielts-frontend`).

**Spec:** `docs/superpowers/specs/2026-11-05-writing-feedback-strengths-design.md`

## Global Constraints

- **Values:**
  - kind values are exactly `"strength"` and `"improvement"`
  - the prompt version string is exactly `writing-academic-v2`
- **Prompt files:**
  - v1 files (`writing_academic_v1.md`, `writing_academic_v1.schema.json`) are not edited or deleted
  - v2 differs from v1 only in rule 4, the comment shape in "What to return", and the schema's comment item
- **Old results:** stored `WritingComment.kind` is optional with default `None`. Old assessment rows must validate unchanged; no migration.
- **Grading:** bands, band descriptors, comment counts (1–3 per criterion), `focus` and the injection rules are unchanged.
- **Frontend rendering:**
  - strength green is the existing `state-correct` token
  - essay strength highlights use a double underline
  - their accessible name starts with `Strength, `
- **Copy:**
  - the panel label for a strength is `What works`
  - the list tag is `Strength`
  - the empty-panel hint is `Tap a highlight to see the feedback`
- **Contract:** the backend schema change and the regenerated `ielts-frontend/types/` land on the same branch (root CLAUDE.md).
- **Branch:** work on `feat/writing-strengths`, cut from `main`. The uncommitted coach-panel change already in the working tree (no strikethrough when there is no suggestion) is committed first. It is the null-kind behaviour.

## Review Focus

1. **The model sends a `strength` with a suggestion.** The comment is kept and the suggestion becomes null; the attempt doesn't fail. (Task 1 test.)
2. **An old result whose comments have no `kind` key.** It loads, and serves `kind: null`. (Task 2 test.)
3. **The quote check drops a strength's quote** because it isn't in the essay. The comment keeps `kind: "strength"` and appears under "Other comments" with the Strength tag. (Task 1 and Task 4 tests.)
4. **Overlapping highlights:**
   - a strength highlight with an improvement attached shows two panel entries, each in its own style
   - the highlight itself stays green (Task 4 test)
5. **The "task" criterion's teal next to green.** A Task Achievement strength must still be told apart from a Task Achievement improvement by underline style and accessible name, not by colour. (Task 4 test.)

---

### Task 1: Prompt v2 and parsing `kind`

**Files:**
- Create:
  - `ielts-backend/core/ai/prompts/writing_academic_v2.md` (copy of v1, edited)
  - `ielts-backend/core/ai/prompts/writing_academic_v2.schema.json` (copy of v1, edited)
- Modify:
  - `ielts-backend/core/models/enums.py`
  - `ielts-backend/core/ai/prompts/__init__.py`
  - `ielts-backend/core/ai/output.py`
  - `ielts-backend/tests/ai_helpers.py`
- Test:
  - `ielts-backend/tests/test_ai_output.py`
  - `ielts-backend/tests/test_ai_messages.py`

**Interfaces:**
- Produces:
  - `CommentKind` in `core/models/enums.py`: a `StrEnum` with `STRENGTH = "strength"` and `IMPROVEMENT = "improvement"`. Follow how `Criterion` is declared there.
  - `ModelComment.kind: CommentKind` (required)
  - `PROMPT_VERSION == "writing-academic-v2"`
  - `system_prompt()` and `response_schema()` read the v2 files

- [ ] **Step 0: Branch and commit the pending fix**

```bash
git switch -c feat/writing-strengths
git add ielts-frontend/components/result/coach-panel.tsx ielts-frontend/components/result/result-screen.test.tsx
git commit -m "fix(frontend): don't strike out quoted words that have no suggestion"
```

- [ ] **Step 1: Write the failing tests**

Update the helpers in `tests/ai_helpers.py`:
- `task_output` gives each comment `"kind": "improvement"`
- add a `kind` parameter (default `"improvement"`)

Then add these tests to `tests/test_ai_output.py`:

```python
def test_parse_output_keeps_kind() -> None:
    output = model_output()
    output["task2"]["criteria"][1]["comments"] = [
        {"kind": "strength", "comment": "Good linking.", "quote": "However", "suggestion": None}
    ]
    parsed = parse_output(completion(output), {1, 2})
    assert parsed.task2 is not None
    comment = next(c for c in parsed.task2.criteria if c.criterion == Criterion.COHERENCE_COHESION).comments[0]
    assert comment.kind == CommentKind.STRENGTH
    assert comment.suggestion is None


def test_parse_output_strength_drops_suggestion() -> None:
    output = model_output()
    output["task2"]["criteria"][0]["comments"] = [
        {"kind": "strength", "comment": "Nice.", "quote": "x", "suggestion": "y"}
    ]
    parsed = parse_output(completion(output), {1, 2})
    assert parsed.task2 is not None
    c = parsed.task2.criteria[0].comments[0]
    assert (c.kind, c.quote, c.suggestion) == (CommentKind.STRENGTH, "x", None)


def test_quote_check_keeps_kind() -> None:
    # A strength whose quote isn't in the essay loses the quote but stays a strength.
    ...  # build a ModelTask with one strength comment quoting "not in essay"; check_quotes(task, "essay text")
    # assert kind == CommentKind.STRENGTH and quote is None
```

Add to the `test_parse_output_rejects` parametrize list:
- `_missing_kind`, which deletes `kind` from the first comment
- `_bad_kind`, which sets it to `"praise"`

In `tests/test_ai_messages.py`:
- change the version assertion to `assert PROMPT_VERSION == "writing-academic-v2"`
- add:

```python
def test_v2_schema_requires_kind() -> None:
    item = response_schema()["properties"]["task1"]["properties"]["criteria"]["items"]["properties"]["comments"]["items"]
    assert "kind" in item["required"]
    assert item["properties"]["kind"]["enum"] == ["strength", "improvement"]


def test_v1_files_unchanged_and_v2_differs_only_in_comments() -> None:
    v1 = (PROMPTS / "writing_academic_v1.md").read_text(encoding="utf-8")
    v2 = system_prompt()
    assert "strength" not in v1
    assert "`kind`" in v2
    # Band descriptors are byte-identical: everything from "# Task 1 (Academic)" up to "# What to return".
    section = lambda s: s[s.index("# Task 1 (Academic)") : s.index("# What to return")]
    assert section(v1) == section(v2)
```

`PROMPTS` is `Path(core.ai.prompts.__file__).parent`.

- [ ] **Step 2: Run them and check they fail**

Run: `uv run pytest tests/test_ai_output.py tests/test_ai_messages.py -q`
Expected: the new tests fail (the `kind` attribute or v2 files are missing; the version is still v1).

- [ ] **Step 3: Write the v2 prompt and schema**

Copy the two v1 files to v2, then make these changes:
- **Rule 4** becomes exactly:
  > 4. Every comment has a `kind`. Use `"strength"` for something the candidate does well and `"improvement"` for something that would raise the band if changed. When a comment refers to the candidate's language, quote their words EXACTLY as written, including their mistakes, in `quote`. For an improvement, give the corrected or improved version in `suggestion`; a strength never has a suggestion, so set it to null. Never invent, paraphrase or tidy up a quote. If a comment is not about specific words, set both `quote` and `suggestion` to null.
- **"What to return":** each comment object gains `"kind": "strength" or "improvement",` as its first line.
- **Schema:** the comment item gains `"kind": {"type": "string", "enum": ["strength", "improvement"]}`, and `kind` is added to `required`. This applies in both the task1 and task2 comment items.

- [ ] **Step 4: Point the loader at v2, and add `kind` to the parser**

- In `core/ai/prompts/__init__.py`:
  - set `PROMPT_VERSION = "writing-academic-v2"`
  - read the v2 files
  - keep the module docstring
- In `core/ai/output.py`:
  - add `kind: CommentKind` to `ModelComment`
  - add a `model_validator(mode="after")` that returns `self.model_copy(update={"suggestion": None})` when `kind is STRENGTH` and `suggestion is not None`. Because the model is frozen, use `model_copy`, or switch to a `mode="before"` validator that edits the dict; either is fine.
  - `check_quotes` already copies the comment, so `kind` survives.

- [ ] **Step 5: Run the suites**

Run: `uv run pytest tests/test_ai_output.py tests/test_ai_messages.py tests/test_ai_injection.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add ielts-backend/core/models/enums.py ielts-backend/core/ai ielts-backend/tests/ai_helpers.py ielts-backend/tests/test_ai_output.py ielts-backend/tests/test_ai_messages.py
git commit -m "feat(backend): grading prompt v2 asks for a strength or improvement kind per comment"
```

---

### Task 2: Store and serve `kind`

**Files:**
- Modify:
  - `ielts-backend/core/schemas/session.py` (`WritingComment`)
  - `ielts-backend/core/services/ai_grading.py` (`_graded_task`)
- Test:
  - `ielts-backend/tests/test_ai_grading.py`
  - `ielts-backend/tests/test_session_result.py`

**Interfaces:**
- Consumes: `CommentKind` and `ModelComment.kind` (Task 1).
- Produces: `WritingComment.kind: CommentKind | None = Field(default=None, description="strength or improvement; null when graded before prompt v2")`. Served at `GET /sessions/{id}/result` as `writing.tasks[].criteria[].comments[].kind`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_ai_grading.py`:
- the existing `row.prompt_version` assertion becomes `"writing-academic-v2"`
- in the happy-path test (the one that checks the stored result), assert that the stored comment JSON has `"kind": "improvement"`

In `tests/test_session_result.py`, add:

```python
async def test_result_serves_comment_kind(...):  # reuse this file's ready-assessment setup
    # ready assessment whose stored result has one comment with "kind": "strength"
    # GET /sessions/{id}/result -> writing.tasks[0].criteria[0].comments[0]["kind"] == "strength"


async def test_result_old_comment_without_kind(...):
    # stored result JSON written WITHOUT any "kind" keys (as v1 rows are)
    # GET -> 200, and every comment has "kind": None
```

- [ ] **Step 2: Run them and check they fail**

Run: `uv run pytest tests/test_ai_grading.py tests/test_session_result.py -q`
Expected: the new and changed assertions fail.

- [ ] **Step 3: Implement**

- Add the field to `WritingComment`.
- Pass `kind=x.kind` in `_graded_task`.

- [ ] **Step 4: Run the full backend checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy .`
Expected: all pass. Docker is required for pytest.

- [ ] **Step 5: Commit**

```bash
git add ielts-backend/core/schemas/session.py ielts-backend/core/services/ai_grading.py ielts-backend/tests
git commit -m "feat(backend): store and serve each Writing comment's kind"
```

---

### Task 3: Refresh the API types

**Files:**
- Modify:
  - `ielts-frontend/types/openapi.json`
  - `ielts-frontend/types/api.ts`
  - `ielts-frontend/tests/fixtures/result.ts`

**Interfaces:**
- Produces: `Schemas["WritingComment"]["kind"]` is `"strength" | "improvement" | null` (optional or nullable, whichever the generator emits).
- Every `makeWritingResult()` comment carries `kind: "improvement"`. The fixture keeps its existing text, so earlier tests keep passing.

- [ ] **Step 1:** From `ielts-frontend`, run `npm run api:snapshot && npm run gen:api`. Expected: `git diff types/` shows only the new `kind` field (plus `CommentKind` if it's emitted as a named schema).
- [ ] **Step 2:** Add `kind` to the fixture comments.
- [ ] **Step 3:** Run `npx tsc --noEmit && npm test`. Expected: all pass.
- [ ] **Step 4: Commit**

```bash
git add ielts-frontend/types ielts-frontend/tests/fixtures/result.ts
git commit -m "chore(frontend): refresh OpenAPI types for Writing comment kind"
```

---

### Task 4: Strengths in green on the results page

**Files:**
- Modify:
  - `ielts-frontend/lib/result/highlights.ts` (`FeedbackComment` gains `kind`)
  - `ielts-frontend/components/result/writing-result.tsx` (maps `kind`)
  - `ielts-frontend/lib/result/format.ts` (adds `STRENGTH_MARK`)
  - `ielts-frontend/components/result/highlighted-essay.tsx`
  - `ielts-frontend/components/result/coach-panel.tsx`
  - `ielts-frontend/CLAUDE.md` (flow 5: mention strengths)
- Test:
  - `ielts-frontend/components/result/result-screen.test.tsx`

**Interfaces:**
- Consumes: `kind` from Task 3.
- Produces:
  - `FeedbackComment.kind: "strength" | "improvement" | null`
  - `STRENGTH_MARK` in `format.ts`: `"bg-state-correct/15 text-foreground underline decoration-double decoration-state-correct decoration-2 underline-offset-4"`

Rendering rules (from the spec):
- **Essay highlight.** The highlight's kind is the kind of its first comment, `commentIds[0]`.
  - Strength: `STRENGTH_MARK`, with aria-label `` `Strength, ${CRITERION_LABELS[criterion]}: ${slice}` ``.
  - Otherwise: unchanged.
- **Coach panel `Fix`:**
  - Strength: a box with `bg-state-correct/10` and a label row of `✓` (aria-hidden) plus `What works`. The quote is wrapped in a mark with `STRENGTH_MARK` and no line-through. There's no "Better" box and no "No change suggested" line.
  - `improvement` and `null`: today's code.
- **Panel list items and "Other comments" items** with kind strength get a leading `<span>` containing `✓` (aria-hidden) and the text `Strength`, styled `text-xs font-medium` in `text-foreground`. Don't use green text for it: green text on white may fall short of 4.5:1, so green goes only on the dot or background.
- **Empty-panel hint:** `Tap a highlight to see the feedback`.

- [ ] **Step 1: Write the failing tests**

Add a fixture helper in the test file:
- `withStrength()` returns `makeWritingResult()` with Task 1's lexical_resource comments replaced by `[{ kind: "strength", comment: "Good word choice.", quote: "between 2000 and 2020", suggestion: null }]`
- the fixture's Task 1 essay is `"Overall, the graph go up between 2000 and 2020.\n\nThe graph go up again in 2010."`

```ts
test("a strength highlight is green with a double underline and a Strength name", async () => {
  serve(withStrength());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const mark = await screen.findByRole("button", { name: "Strength, Lexical Resource: between 2000 and 2020" });
  expect(mark).toHaveClass("decoration-double");
  expect(mark).toHaveClass("bg-state-correct/15");
});

test("the coach panel shows a strength as What works, not struck out, with no Better", async () => {
  serve(withStrength());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Strength, Lexical Resource/ }));
  const panel = screen.getByRole("complementary", { name: /^Highlight/ });
  expect(within(panel).getByText("What works")).toBeInTheDocument();
  expect(within(panel).queryByText("You wrote")).toBeNull();
  expect(within(panel).queryByText("Better")).toBeNull();
  expect(within(panel).getByText("between 2000 and 2020", { selector: "mark" })).not.toHaveClass("line-through");
});

test("a Task Achievement strength differs from a Task Achievement improvement without colour", async () => {
  // Task 1's TA comment becomes a strength on "the graph go up"; GRA stays an improvement.
  // Assert the TA mark's name starts "Strength, Task Achievement:" and has decoration-double,
  // and the GRA mark's name has no "Strength," prefix and no decoration-double.
});

test("strengths are tagged in the comment list and in Other comments", async () => {
  // withStrength() plus "No overview given." (quote null) as kind strength.
  // Panel empty state: the list button for "Good word choice." contains the text "Strength";
  // the "Other comments on this task" section item for "No overview given." contains "Strength".
});

test("an improvement attached to a strength highlight shows both in their own styles", async () => {
  // Task 1's TA comments become, in this order:
  //   { kind: "strength", quote: "Overall, the graph go up", suggestion: null, comment: "Clear overview." }
  //   { kind: "improvement", quote: "the graph go up", suggestion: "the graph rises", comment: "Covers the key trends." }
  // The improvement overlaps the strength, so it attaches to the strength's highlight.
  // Click the "Strength, Task Achievement: Overall, the graph go up" highlight: the panel shows
  // "What works" once and "Better" once; the essay mark has decoration-double.
});

test("comments without kind render as before", async () => {
  // makeWritingResult() with kind removed from every comment (old result):
  // "You wrote" and "Better" show for "the graph go up"; no "What works" anywhere.
});
```

Update the existing assertions on `"Tap a highlight to see the fix"` to the new hint.

- [ ] **Step 2: Run them and check they fail**

Run: `npx vitest run components/result/result-screen.test.tsx`
Expected: the new tests fail.

- [ ] **Step 3: Implement the rendering rules above**

- [ ] **Step 4: Run the frontend checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ielts-frontend/lib/result ielts-frontend/components/result ielts-frontend/CLAUDE.md
git commit -m "feat(frontend): show Writing strengths in green on the results page"
```

---

### Task 5: Band check and live check (needs the owner's go-ahead)

These steps call the real model on the owner's OpenRouter key. Ask before running them.

- [ ] **Step 1: v1 baseline.** From a checkout of `main`, in `ielts-backend`, run `uv run python scripts/ai_check.py seed`. Record each criterion band for both runs.
- [ ] **Step 2: v2.** On `feat/writing-strengths`, run the same command. Expected: every criterion band is within 0.5 of the v1 band for the same task and criterion, and every comment has a `kind`. If any band moves by more than 0.5, stop and report; don't tune the prompt without the owner.
- [ ] **Step 3: Red team.** Run `uv run python scripts/ai_check.py redteam`. Expected: exit 0.
- [ ] **Step 4: Live check.**
  - Rebuild the API with `docker compose up -d --build api`.
  - Submit a Writing practice session as the local test student and wait for grading.
  - Check that strengths show green in the essay, panel and lists, at desktop width and at 375px.
  - Check that an old result, such as session `01a1a602-…`, still renders as before.
- [ ] **Step 5:** Record the band comparison in `ielts-backend/docs/superpowers/logs/` as `2026-11-05-prompt-v2-band-check.md` and commit it with `docs(backend): …`.
