import type { Criterion } from "@/lib/api/types";
import { CRITERION_LABELS, CRITERION_TONE, TONE_CLASSES } from "@/lib/result/format";
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
          const criterion = shown[0].criterion;
          const slice = paragraph.text.slice(h.start, h.end);
          if (h.start > at) parts.push(paragraph.text.slice(at, h.start));
          parts.push(
            <button
              key={key}
              type="button"
              data-highlight={key}
              aria-pressed={key === selectedKey}
              onClick={() => onSelect(shown[0].id)}
              className={cn(
                // Buttons lay out as inline-block; long quotes wrap inside their own box.
                // whitespace-normal drops the name separator below at the start of the box.
                "inline rounded-sm px-0.5 text-left whitespace-normal box-decoration-clone",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                TONE_CLASSES[CRITERION_TONE[criterion]].mark,
                key === selectedKey && "ring-2 ring-foreground",
              )}
            >
              <span className="sr-only">{CRITERION_LABELS[criterion]}:</span>{" "}
              <span className="whitespace-pre-wrap">{slice}</span>
            </button>,
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
