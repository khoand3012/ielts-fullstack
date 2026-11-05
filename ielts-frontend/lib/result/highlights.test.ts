import { describe, expect, it } from "vitest";
import {
  placeComments,
  sentenceAround,
  type FeedbackComment,
} from "@/lib/result/highlights";

function c(id: string, quote: string | null): FeedbackComment {
  return {
    id,
    criterion: "task_achievement",
    comment: "c",
    quote,
    suggestion: null,
    kind: null,
  };
}

function slices(essay: string, comments: FeedbackComment[]) {
  const r = placeComments(essay, comments);
  return {
    r,
    texts: r.paragraphs.map((p) =>
      p.highlights.map((h) => p.text.slice(h.start, h.end)),
    ),
  };
}

describe("placeComments", () => {
  it("matches exactly", () => {
    const { r, texts } = slices("The graph go up.", [c("a", "graph go up")]);
    expect(r.paragraphs[0].highlights).toEqual([
      { start: 4, end: 15, commentIds: ["a"] },
    ]);
    expect(texts).toEqual([["graph go up"]]);
  });

  it("falls back to case-insensitive", () => {
    const { texts } = slices("The graph rose.", [c("a", "the graph")]);
    expect(texts).toEqual([["The graph"]]);
  });

  it("normalises quotes, whitespace and dashes", () => {
    expect(slices("It’s  clear", [c("a", "It's clear")]).texts).toEqual([
      ["It’s  clear"],
    ]);
    expect(slices("2000–2020", [c("a", "2000-2020")]).texts).toEqual([
      ["2000–2020"],
    ]);
  });

  it("gives repeated quotes separate occurrences", () => {
    const { r } = slices("go up and go up", [c("a", "go up"), c("b", "go up")]);
    expect(r.paragraphs[0].highlights).toEqual([
      { start: 0, end: 5, commentIds: ["a"] },
      { start: 10, end: 15, commentIds: ["b"] },
    ]);
  });

  it("spreads case-fallback repeats and attaches extras to the first", () => {
    const { r } = slices("The graph rose and the graph fell", [
      c("a", "The graph"),
      c("b", "The graph"),
      c("c", "The graph"),
    ]);
    expect(r.paragraphs[0].highlights).toEqual([
      { start: 0, end: 9, commentIds: ["a", "c"] },
      { start: 19, end: 28, commentIds: ["b"] },
    ]);
    expect(r.unplaced).toEqual([]);
  });

  it("appends to the first overlapping highlight without widening", () => {
    const { r, texts } = slices("a very big increase", [
      c("a", "very big"),
      c("b", "big increase"),
    ]);
    expect(texts).toEqual([["very big"]]);
    expect(r.paragraphs[0].highlights[0].commentIds).toEqual(["a", "b"]);
  });

  it("does not bridge highlights", () => {
    const { r, texts } = slices("one two three four", [
      c("a", "one two"),
      c("b", "three four"),
      c("c", "two three"),
    ]);
    expect(texts).toEqual([["one two", "three four"]]);
    expect(r.paragraphs[0].highlights.map((h) => h.commentIds)).toEqual([
      ["a", "c"],
      ["b"],
    ]);
  });

  it("merges overlapping highlights", () => {
    const { r, texts } = slices("a very big increase here", [
      c("a", "very big increase"),
      c("b", "big increase"),
    ]);
    expect(r.paragraphs[0].highlights).toHaveLength(1);
    expect(r.paragraphs[0].highlights[0].commentIds).toEqual(["a", "b"]);
    expect(texts).toEqual([["very big increase"]]);
  });

  it("leaves unmatched, null and empty quotes unplaced", () => {
    const { r } = slices("Some text.", [
      c("a", "nothing"),
      c("b", null),
      c("c", ""),
      c("d", "   "),
    ]);
    expect(r.unplaced).toEqual(["a", "b", "c", "d"]);
    expect(r.paragraphs[0].highlights).toEqual([]);
  });

  it("does not match across paragraphs", () => {
    const { r } = slices("End one.\n\nStart two.", [c("a", "one. Start")]);
    expect(r.unplaced).toEqual(["a"]);
  });

  it("handles CRLF line endings", () => {
    const { r, texts } = slices("Para one.\r\n\r\nPara two goes up.", [
      c("a", "goes up"),
    ]);
    expect(r.paragraphs).toHaveLength(2);
    expect(texts).toEqual([[], ["goes up"]]);
  });

  it("trims the quote", () => {
    expect(slices("it goes up", [c("a", " goes up ")]).texts).toEqual([
      ["goes up"],
    ]);
  });

  it("handles an empty essay", () => {
    const r = placeComments("", [c("a", "x"), c("b", null)]);
    expect(r.paragraphs).toEqual([]);
    expect(r.unplaced).toEqual(["a", "b"]);
    expect(r.ranges).toEqual({});
  });

  it("keeps offsets aligned when lower-casing changes length", () => {
    const { texts } = slices("İ test here", [c("a", "TEST HERE")]);
    expect(texts).toEqual([["test here"]]);
  });
});

describe("sentenceAround", () => {
  it("widens to the enclosing sentence", () => {
    const t = "A one. B two here. C.";
    const r = sentenceAround(t, 9, 12);
    expect(t.slice(r.start, r.end)).toBe("B two here.");
  });

  it("stops at paragraph bounds", () => {
    const t = "no punctuation";
    expect(sentenceAround(t, 3, 5)).toEqual({ start: 0, end: t.length });
  });

  it("does not split on a full stop inside a number or abbreviation", () => {
    const t = "Before. Sales rose to 2.5 million in 2010 and fell after. Then.";
    const whole = "Sales rose to 2.5 million in 2010 and fell after.";
    for (const quote of ["rose to", "million in 2010"]) {
      const at = t.indexOf(quote);
      const r = sentenceAround(t, at, at + quote.length);
      expect(t.slice(r.start, r.end)).toBe(whole);
    }
    const g = "It rose 12.5%, e.g.in March, then fell!";
    const at = g.indexOf("then");
    expect(sentenceAround(g, at, at + 4)).toEqual({ start: 0, end: g.length });
  });
});

describe("placeComments ranges", () => {
  it("records each comment's own matched range, even when attached by overlap", () => {
    const essay = "a very big increase isn’t here.";
    const { r, texts } = slices(essay, [
      c("a", "very big"),
      c("b", "big increase isn't"),
    ]);
    // Placement is append-only: the highlight stays "very big".
    expect(texts).toEqual([["very big"]]);
    expect(r.paragraphs[0].highlights[0].commentIds).toEqual(["a", "b"]);
    const slice = (id: string) => {
      const range = r.ranges[id];
      return r.paragraphs[range.paragraph].text.slice(range.start, range.end);
    };
    expect(slice("a")).toBe("very big");
    expect(slice("b")).toBe("big increase isn’t");
  });

  it("records the paragraph and omits unplaced comments", () => {
    const r = placeComments("One here.\n\nTwo there.", [
      c("a", "there"),
      c("b", "nowhere"),
    ]);
    expect(r.ranges).toEqual({ a: { paragraph: 1, start: 4, end: 9 } });
  });
});
