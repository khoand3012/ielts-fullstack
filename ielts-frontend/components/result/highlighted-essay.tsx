import { CRITERION_LABELS, CRITERION_TONE, STRENGTH_MARK, TONE_CLASSES } from "@/lib/result/format";
import type { WritingFeedbackView } from "@/lib/result/writing-feedback";
import { cn } from "@/lib/utils";

export function HighlightedEssay({
  paragraphs,
  onOpen,
}: {
  paragraphs: WritingFeedbackView["paragraphs"];
  onOpen(key: string): void;
}) {
  return (
    <div className="grid gap-4 text-base leading-8">
      {paragraphs.map((segments, p) => (
        <p key={p} className="whitespace-pre-wrap">
          {segments.map((s) =>
            typeof s === "string" ? (
              s
            ) : (
              // A <button> lays out as inline-block and breaks the paragraph flow on long quotes, so
              // the highlight is an inline mark with button semantics. Its text is only the slice,
              // so the paragraph reads exactly as written; the criterion goes in aria-label.
              <mark
                key={s.key}
                role="button"
                tabIndex={0}
                data-highlight={s.key}
                aria-pressed={s.selected}
                aria-label={`${s.strength ? "Strength, " : ""}${CRITERION_LABELS[s.criterion]}: ${s.text}`}
                onClick={() => onOpen(s.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(s.key);
                  }
                }}
                className={cn(
                  // box-decoration-clone repeats the tint, ring and radius on every line fragment.
                  "cursor-pointer rounded-sm px-0.5 box-decoration-clone",
                  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
                  s.strength ? STRENGTH_MARK : TONE_CLASSES[CRITERION_TONE[s.criterion]].mark,
                  s.selected && "ring-2 ring-foreground",
                )}
              >
                {s.text}
              </mark>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
