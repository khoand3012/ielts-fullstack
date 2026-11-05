import type { Criterion, WritingTask } from "@/lib/api/types";
import { type FeedbackComment, type Highlight, placeComments, sentenceAround } from "@/lib/result/highlights";

/**
 * How a Writing comment is shown, the same in the coach panel and in Other comments
 * (see GLOSSARY.md, "Display variant").
 */
export type DisplayVariant = "strength" | "fix" | "mark" | "legacy-no-change";

export type CommentView = {
  id: string;
  criterion: Criterion;
  comment: string;
  /** The quote as the grader wrote it; the essay's own words are in `excerpt`. */
  quote: string | null;
  variant: DisplayVariant;
  /** Only a fix carries a suggestion. */
  suggestion: string | null;
};

/** A placed comment in the panel list, with the highlight it selects. */
export type ListedComment = CommentView & { key: string };

/** A comment on the selected highlight, with the sentence around its own quote. */
export type SelectedComment = CommentView & {
  excerpt: { before: string; words: string; after: string };
  /** The sentence with the suggestion in place of the quote; only for a fix. */
  rewrite: string | null;
};

export type HighlightView = {
  /** `<paragraph>-<index>`; stable across filters. */
  key: string;
  text: string;
  /** From the lead comment: the first comment on the highlight that passes the filter. */
  criterion: Criterion;
  strength: boolean;
  selected: boolean;
};

export type WritingFeedbackView = {
  /** No essay text: blank, or an old result saved before essay text was returned. */
  blank: boolean;
  /** Each paragraph as plain text and visible highlights, in reading order. */
  paragraphs: (string | HighlightView)[][];
  /** Keys of the visible highlights, in essay order (Previous/Next). */
  order: string[];
  selected: {
    key: string;
    /** 1-based. */
    position: number;
    total: number;
    prevKey: string | null;
    nextKey: string | null;
    comments: SelectedComment[];
  } | null;
  /** Visible placed comments grouped by criterion, in first-seen order. */
  groups: { criterion: Criterion; items: ListedComment[] }[];
  /** Visible comments that could not be placed in the essay. */
  other: CommentView[];
  /** How many comments pass the filter. */
  visibleCount: number;
};

function variantOf(kind: FeedbackComment["kind"], suggestion: string | null): DisplayVariant {
  if (kind === "strength") return "strength";
  if (suggestion?.trim()) return "fix";
  // kind null: graded before kinds existed.
  return kind === null ? "legacy-no-change" : "mark";
}

function view(c: FeedbackComment): CommentView {
  const variant = variantOf(c.kind, c.suggestion);
  return {
    id: c.id,
    criterion: c.criterion,
    comment: c.comment,
    quote: c.quote,
    variant,
    suggestion: variant === "fix" ? c.suggestion : null,
  };
}

/**
 * Everything the Writing result renders for one task, given the criterion filter and the
 * selected highlight key. Pure: the components only render what this returns.
 */
export function writingFeedback(
  task: WritingTask,
  { filter, selectedKey }: { filter: Criterion | null; selectedKey: string | null },
): WritingFeedbackView {
  const comments: FeedbackComment[] = task.criteria.flatMap((c) =>
    c.comments.map((x, i) => ({
      id: `${c.criterion}-${i}`,
      criterion: c.criterion,
      comment: x.comment,
      quote: x.quote,
      suggestion: x.suggestion,
      kind: x.kind ?? null,
    })),
  );
  const byId = new Map(comments.map((c) => [c.id, c]));
  const visible = (c: FeedbackComment) => filter === null || c.criterion === filter;
  const text = task.text ?? "";
  const placed = placeComments(text, comments);

  const keyOf = new Map<string, string>();
  const shownOn: { key: string; paragraph: string; highlight: Highlight; shown: FeedbackComment[] }[] = [];

  const paragraphs = placed.paragraphs.map((paragraph, p) => {
    const segments: (string | HighlightView)[] = [];
    let at = 0;
    paragraph.highlights.forEach((h, i) => {
      const key = `${p}-${i}`;
      for (const id of h.commentIds) keyOf.set(id, key);
      const shown = h.commentIds.map((id) => byId.get(id)!).filter(visible);
      if (shown.length === 0) return;
      const lead = shown[0];
      shownOn.push({ key, paragraph: paragraph.text, highlight: h, shown });
      if (h.start > at) segments.push(paragraph.text.slice(at, h.start));
      segments.push({
        key,
        text: paragraph.text.slice(h.start, h.end),
        criterion: lead.criterion,
        strength: lead.kind === "strength",
        selected: key === selectedKey,
      });
      at = h.end;
    });
    if (at < paragraph.text.length) segments.push(paragraph.text.slice(at));
    return segments;
  });

  const order = shownOn.map((s) => s.key);
  const index = order.findIndex((k) => k === selectedKey);
  let selected: WritingFeedbackView["selected"] = null;
  if (index !== -1) {
    const { key, paragraph, highlight, shown } = shownOn[index];
    selected = {
      key,
      position: index + 1,
      total: order.length,
      prevKey: order[index - 1] ?? null,
      nextKey: order[index + 1] ?? null,
      comments: shown.map((c) => {
        // A comment attached by overlap may cover a different span than the highlight.
        const r = placed.ranges[c.id] ?? highlight;
        const s = sentenceAround(paragraph, r.start, r.end);
        const before = paragraph.slice(s.start, r.start);
        const after = paragraph.slice(r.end, s.end);
        const v = view(c);
        return {
          ...v,
          excerpt: { before, words: paragraph.slice(r.start, r.end), after },
          rewrite: v.suggestion === null ? null : before + v.suggestion + after,
        };
      }),
    };
  }

  const shownComments = comments.filter(visible);
  const unplaced = new Set(placed.unplaced);
  const groups: WritingFeedbackView["groups"] = [];
  for (const c of shownComments) {
    if (unplaced.has(c.id)) continue;
    let group = groups.find((g) => g.criterion === c.criterion);
    if (!group) groups.push((group = { criterion: c.criterion, items: [] }));
    group.items.push({ ...view(c), key: keyOf.get(c.id)! });
  }

  return {
    blank: text.trim() === "",
    paragraphs,
    order,
    selected,
    groups,
    other: shownComments.filter((c) => unplaced.has(c.id)).map(view),
    visibleCount: shownComments.length,
  };
}
