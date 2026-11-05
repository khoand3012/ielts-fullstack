import type { Criterion } from "@/lib/api/types";
import { CRITERION_LABELS, CRITERION_TONE, STRENGTH_MARK, TONE_CLASSES } from "@/lib/result/format";
import type {
  EssayParagraph,
  FeedbackComment,
  Highlight,
  PlacedEssay,
} from "@/lib/result/highlights";
import { cn } from "@/lib/utils";

/** The highlight's comments that pass the filter, in the highlight's order. */
export function commentsOn(
  h: Highlight,
  comments: FeedbackComment[],
  filter: Criterion | null,
): FeedbackComment[] {
  return h.commentIds.flatMap((id) => {
    const c = comments.find((x) => x.id === id);
    return c && (filter === null || c.criterion === filter) ? [c] : [];
  });
}

export type FoundHighlight = { key: string; paragraph: EssayParagraph; highlight: Highlight };

/** The highlight carrying a comment; `key` matches the button's `data-highlight`. */
export function findHighlight(placed: PlacedEssay, commentId: string): FoundHighlight | null {
  for (let p = 0; p < placed.paragraphs.length; p++) {
    const paragraph = placed.paragraphs[p];
    const i = paragraph.highlights.findIndex((h) => h.commentIds.includes(commentId));
    if (i !== -1) return { key: `${p}-${i}`, paragraph, highlight: paragraph.highlights[i] };
  }
  return null;
}

export function HighlightedEssay({
  placed,
  comments,
  filter,
  selectedId,
  onSelect,
}: {
  placed: PlacedEssay;
  comments: FeedbackComment[];
  filter: Criterion | null;
  selectedId: string | null;
  onSelect(commentId: string): void;
}) {
  const selectedKey = selectedId ? findHighlight(placed, selectedId)?.key : undefined;
  return (
    <div className="grid gap-4 text-base leading-8">
      {placed.paragraphs.map((paragraph, p) => {
        const parts: React.ReactNode[] = [];
        let at = 0;
        paragraph.highlights.forEach((h, i) => {
          const shown = commentsOn(h, comments, filter);
          if (shown.length === 0) return;
          const key = `${p}-${i}`;
          // One source for what the mark shows: the first visible comment.
          const first = shown[0];
          const { criterion } = first;
          const slice = paragraph.text.slice(h.start, h.end);
          const strength = first.kind === "strength";
          if (h.start > at) parts.push(paragraph.text.slice(at, h.start));
          const select = () => onSelect(first.id);
          parts.push(
            // A <button> lays out as inline-block and breaks the paragraph flow on long quotes, so
            // the highlight is an inline mark with button semantics. Its text is only the slice,
            // so the paragraph reads exactly as written; the criterion goes in aria-label.
            <mark
              key={key}
              role="button"
              tabIndex={0}
              data-highlight={key}
              aria-pressed={key === selectedKey}
              aria-label={`${strength ? "Strength, " : ""}${CRITERION_LABELS[criterion]}: ${slice}`}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select();
                }
              }}
              className={cn(
                // box-decoration-clone repeats the tint, ring and radius on every line fragment.
                "cursor-pointer rounded-sm px-0.5 box-decoration-clone",
                "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
                strength ? STRENGTH_MARK : TONE_CLASSES[CRITERION_TONE[criterion]].mark,
                key === selectedKey && "ring-2 ring-foreground",
              )}
            >
              {slice}
            </mark>,
          );
          at = h.end;
        });
        if (at < paragraph.text.length) parts.push(paragraph.text.slice(at));
        return (
          <p key={p} className="whitespace-pre-wrap">
            {parts}
          </p>
        );
      })}
    </div>
  );
}
