import { describe, expect, it } from "vitest";
import type { Criterion, WritingTask } from "@/lib/api/types";
import { writingFeedback, type HighlightView } from "@/lib/result/writing-feedback";

type Comment = WritingTask["criteria"][number]["comments"][number];

const ESSAY = "Overall, the graph go up between 2000 and 2020.\n\nThe graph go up again in 2010.";

function task(comments: Partial<Record<Criterion, Comment[]>>, text = ESSAY): WritingTask {
  return {
    number: 1,
    band: 6,
    word_count: 20,
    text,
    criteria: Object.entries(comments).map(([criterion, list]) => ({
      criterion: criterion as Criterion,
      band: 6,
      comments: list ?? [],
    })),
  };
}

const improvement = (quote: string | null, suggestion: string | null, comment = "Fix it."): Comment => ({
  comment,
  quote,
  suggestion,
  kind: "improvement",
});
const strength = (quote: string | null, suggestion: string | null = null, comment = "Nice."): Comment => ({
  comment,
  quote,
  suggestion,
  kind: "strength",
});
const legacy = (quote: string | null, suggestion: string | null, comment = "Old."): Comment => ({
  comment,
  quote,
  suggestion,
  kind: null,
});

const none = { filter: null, selectedKey: null };
const highlights = (paragraph: (string | HighlightView)[]) =>
  paragraph.filter((s): s is HighlightView => typeof s !== "string");

describe("essay segments", () => {
  it("splits each paragraph into plain text and highlights that read exactly as written", () => {
    const v = writingFeedback(
      task({ task_achievement: [improvement("the graph go up", "the graph rises")] }),
      none,
    );
    expect(v.paragraphs).toHaveLength(2);
    const [first] = v.paragraphs;
    expect(first.map((s) => (typeof s === "string" ? s : s.text)).join("")).toBe(
      "Overall, the graph go up between 2000 and 2020.",
    );
    expect(highlights(first)).toEqual([
      expect.objectContaining({ key: "0-0", text: "the graph go up", criterion: "task_achievement", strength: false }),
    ]);
  });

  it("an old result without essay text has no paragraphs and is blank", () => {
    // Results saved before essay text was returned have no `text`.
    const old = { ...task({ task_achievement: [improvement("x", null)] }), text: undefined as unknown as string };
    const v = writingFeedback(old, none);
    expect(v.paragraphs).toEqual([]);
    expect(v.blank).toBe(true);
  });
});

describe("lead comment", () => {
  const overlapping = task({
    task_achievement: [strength("Overall, the graph go up")],
    grammatical_range_accuracy: [improvement("the graph go up", "the graph went up")],
  });

  it("a highlight takes its criterion and kind from its first comment", () => {
    const [h] = highlights(writingFeedback(overlapping, none).paragraphs[0]);
    expect(h).toMatchObject({ criterion: "task_achievement", strength: true, text: "Overall, the graph go up" });
  });

  it("a filtered highlight takes its kind from its first visible comment", () => {
    const v = writingFeedback(overlapping, { filter: "grammatical_range_accuracy", selectedKey: null });
    const [h] = highlights(v.paragraphs[0]);
    expect(h).toMatchObject({ key: "0-0", criterion: "grammatical_range_accuracy", strength: false });
  });

  it("a highlight with no visible comment renders as plain text, and its key is kept", () => {
    const t = task({
      task_achievement: [improvement("Overall", "In summary")],
      grammatical_range_accuracy: [improvement("the graph go up", "the graph went up")],
    });
    const v = writingFeedback(t, { filter: "grammatical_range_accuracy", selectedKey: null });
    expect(highlights(v.paragraphs[0]).map((h) => h.key)).toEqual(["0-1"]);
    expect(v.paragraphs[0][0]).toBe("Overall, ");
  });
});

describe("display variants", () => {
  it("resolves strength, fix, mark-only and legacy no-change", () => {
    const v = writingFeedback(
      task({
        task_achievement: [
          strength("Overall", "ignored suggestion"),
          improvement("graph go up between", "graph rose between"),
          improvement("2000", "   "),
          legacy("2020", null),
          legacy("again", "once more"),
        ],
      }),
      none,
    );
    const items = v.groups.flatMap((g) => g.items);
    expect(items.map((c) => [c.comment, c.variant, c.suggestion])).toEqual([
      ["Nice.", "strength", null],
      ["Fix it.", "fix", "graph rose between"],
      ["Fix it.", "mark", null],
      ["Old.", "legacy-no-change", null],
      ["Old.", "fix", "once more"],
    ]);
  });

  it("unplaced comments follow the same rules: a strength never carries a suggestion", () => {
    const v = writingFeedback(
      task({
        task_achievement: [
          strength(null, "do not show"),
          improvement(null, "  "),
          improvement("not in the essay", "something"),
        ],
      }),
      none,
    );
    expect(v.other.map((c) => [c.variant, c.suggestion])).toEqual([
      ["strength", null],
      ["mark", null],
      ["fix", "something"],
    ]);
    expect(v.groups).toEqual([]);
  });
});

describe("selection", () => {
  const two = task({
    task_achievement: [improvement("the graph go up", "the graph rises", "Covers the key trends.")],
    grammatical_range_accuracy: [improvement("The graph go up", "The graph went up", "Use the past tense.")],
  });

  it("orders visible highlights in essay order and resolves the selected one", () => {
    const v = writingFeedback(two, { filter: null, selectedKey: "1-0" });
    expect(v.order).toEqual(["0-0", "1-0"]);
    expect(v.selected).toMatchObject({ key: "1-0", position: 2, total: 2, prevKey: "0-0", nextKey: null });
    expect(v.selected!.comments.map((c) => c.comment)).toEqual(["Use the past tense."]);
    expect(highlights(v.paragraphs[1])[0].selected).toBe(true);
    expect(highlights(v.paragraphs[0])[0].selected).toBe(false);
  });

  it("each placed comment in the list carries its highlight key", () => {
    const v = writingFeedback(two, none);
    expect(v.groups.map((g) => [g.criterion, g.items.map((c) => c.key)])).toEqual([
      ["task_achievement", ["0-0"]],
      ["grammatical_range_accuracy", ["1-0"]],
    ]);
  });

  it("a key that is hidden by the filter or unknown selects nothing", () => {
    expect(writingFeedback(two, { filter: "task_achievement", selectedKey: "1-0" }).selected).toBeNull();
    expect(writingFeedback(two, { filter: null, selectedKey: "9-9" }).selected).toBeNull();
  });

  it("the selected comments carry their sentence around their own quote and the rewrite", () => {
    const v = writingFeedback(two, { filter: null, selectedKey: "0-0" });
    expect(v.selected!.comments[0]).toMatchObject({
      excerpt: { before: "Overall, ", words: "the graph go up", after: " between 2000 and 2020." },
      rewrite: "Overall, the graph rises between 2000 and 2020.",
    });
  });

  it("a comment attached by overlap uses its own quote, not the highlight's span", () => {
    const t = task(
      {
        lexical_resource: [
          improvement("very big", "very large", "Too vague."),
          improvement("big increase isn't", "large rise is not", "Avoid contractions."),
        ],
      },
      "a very big increase isn’t here.",
    );
    const v = writingFeedback(t, { filter: null, selectedKey: "0-0" });
    expect(v.selected!.comments.map((c) => [c.excerpt.words, c.rewrite])).toEqual([
      ["very big", "a very large increase isn’t here."],
      ["big increase isn’t", "a very large rise is not here."],
    ]);
  });

  it("only a fix has a rewrite", () => {
    const t = task({ task_achievement: [strength("the graph go up", "x"), improvement("2020", " ")] });
    const v = writingFeedback(t, { filter: null, selectedKey: "0-0" });
    expect(v.selected!.comments.map((c) => c.rewrite)).toEqual([null]);
    const w = writingFeedback(t, { filter: null, selectedKey: "0-1" });
    expect(w.selected!.comments.map((c) => c.rewrite)).toEqual([null]);
  });
});

describe("filter", () => {
  it("hides other criteria from the list, the other comments and the order", () => {
    const t = task({
      task_achievement: [improvement("the graph go up", "rises"), improvement(null, null, "No overview.")],
      grammatical_range_accuracy: [improvement("The graph go up", "went up")],
    });
    const v = writingFeedback(t, { filter: "grammatical_range_accuracy", selectedKey: null });
    expect(v.order).toEqual(["1-0"]);
    expect(v.groups.map((g) => g.criterion)).toEqual(["grammatical_range_accuracy"]);
    expect(v.other).toEqual([]);
    expect(v.visibleCount).toBe(1);
  });
});
