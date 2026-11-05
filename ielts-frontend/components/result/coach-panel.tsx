"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { WritingTask } from "@/lib/api/types";
import { CRITERION_LABELS, CRITERION_TONE, TONE_CLASSES } from "@/lib/result/format";
import {
  type FeedbackComment,
  type PlacedEssay,
  type QuoteRange,
  sentenceAround,
} from "@/lib/result/highlights";
import { cn } from "@/lib/utils";
import { commentsOn, findHighlight } from "./highlighted-essay";

function CriterionChip({ comment }: { comment: FeedbackComment }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", TONE_CLASSES[CRITERION_TONE[comment.criterion]].dot)}
      />
      {CRITERION_LABELS[comment.criterion]}
    </span>
  );
}

/** `range` is the comment's own quote, which may differ from the highlight it is attached to. */
function Fix({
  comment,
  text,
  range: r,
}: {
  comment: FeedbackComment;
  text: string;
  range: Pick<QuoteRange, "start" | "end">;
}) {
  const s = sentenceAround(text, r.start, r.end);
  const before = text.slice(s.start, r.start);
  const after = text.slice(r.end, s.end);
  const suggestion = comment.suggestion?.trim() ? comment.suggestion : null;
  // Labels and text on the tints stay text-foreground: muted text drops below 4.5:1 there.
  // Without a suggestion there is nothing to replace (often the comment is praise), so the
  // words are marked in the criterion colour rather than struck out as a mistake.
  return (
    <article className="grid gap-3">
      <CriterionChip comment={comment} />
      <div className={cn("grid gap-1 rounded-lg p-3", suggestion ? "bg-state-wrong/10" : "bg-muted")}>
        <p className="text-xs font-semibold tracking-wide text-foreground uppercase">You wrote</p>
        <p className="whitespace-pre-wrap">
          {before}
          <mark
            className={cn(
              "rounded-sm px-0.5 text-foreground",
              suggestion
                ? "bg-state-wrong/25 line-through decoration-state-wrong decoration-2"
                : TONE_CLASSES[CRITERION_TONE[comment.criterion]].mark,
            )}
          >
            {text.slice(r.start, r.end)}
          </mark>
          {after}
        </p>
        {!suggestion && <p className="text-xs text-foreground">No change suggested for these words.</p>}
      </div>
      {suggestion && (
        <div className="grid gap-1 rounded-lg bg-state-correct/10 p-3">
          <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Better</p>
          <p className="whitespace-pre-wrap">{before + suggestion + after}</p>
        </div>
      )}
      <p className="whitespace-pre-wrap">{comment.comment}</p>
    </article>
  );
}

export function CoachPanel({
  task,
  placed,
  comments,
  selectedId,
  order,
  onSelect,
  onClose,
}: {
  task: WritingTask;
  placed: PlacedEssay;
  /** The task's comments that pass the criterion filter. */
  comments: FeedbackComment[];
  selectedId: string | null;
  /** One comment id per visible highlight, in essay order. */
  order: string[];
  /** `origin` tells the view whether this selection opened the panel ("list") or moved within it. */
  onSelect(commentId: string, origin: "list" | "nav"): void;
  onClose(): void;
}) {
  const headingId = useId();
  const otherId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<"prev" | "next" | null>(null);

  const found = selectedId ? findHighlight(placed, selectedId) : null;
  const shown = found ? commentsOn(found.highlight, comments, null) : [];
  const selection = found && shown.length > 0 ? found : null;
  const selected = selection !== null;
  const pos = selection ? order.findIndex((id) => findHighlight(placed, id)?.key === selection.key) : -1;

  // A new selection moves focus to the heading, except when Previous/Next stays usable.
  useEffect(() => {
    const nav = navRef.current;
    navRef.current = null;
    if (!selectedId) return;
    const button = nav === "prev" ? prevRef.current : nav === "next" ? nextRef.current : null;
    if (button && !button.disabled) return;
    headingRef.current?.focus();
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      // Another overlay that handled Escape first marks it handled; leave the panel open then.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, onClose]);

  const go = (dir: "prev" | "next") => {
    const id = order[pos + (dir === "next" ? 1 : -1)];
    if (!id) return;
    navRef.current = dir;
    onSelect(id, "nav");
  };

  const unplaced = new Set(placed.unplaced);
  const placedComments = comments.filter((c) => !unplaced.has(c.id));
  const otherComments = comments.filter((c) => unplaced.has(c.id));
  const groups = [...new Set(placedComments.map((c) => c.criterion))].map((criterion) => ({
    criterion,
    items: placedComments.filter((c) => c.criterion === criterion),
  }));

  return (
    <aside
      aria-labelledby={headingId}
      className={cn(
        "grid min-w-0 content-start gap-4 rounded-xl border bg-card p-4 text-sm",
        "lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto",
        // Phones and tablets: a selection opens as a bottom sheet over the essay.
        selected &&
          "fixed inset-x-0 bottom-0 z-40 max-h-[60vh] overflow-auto rounded-b-none shadow-[0_-12px_48px_rgb(0_0_0/0.28)] lg:inset-x-auto lg:bottom-auto lg:z-auto lg:rounded-b-xl lg:shadow-none",
      )}
    >
      {selection ? (
        <>
          <div className="flex items-center gap-2">
            <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
              Highlight {pos + 1} of {order.length}
            </h3>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </div>
          {shown.map((c) => (
            <Fix
              key={c.id}
              comment={c}
              text={selection.paragraph.text}
              range={placed.ranges[c.id] ?? selection.highlight}
            />
          ))}
          <div className="flex gap-2">
            <Button ref={prevRef} variant="outline" size="sm" disabled={pos <= 0} onClick={() => go("prev")}>
              Previous
            </Button>
            <Button
              ref={nextRef}
              variant="outline"
              size="sm"
              disabled={pos === -1 || pos >= order.length - 1}
              onClick={() => go("next")}
            >
              Next
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
            Task {task.number} feedback
          </h3>
          {order.length > 0 && <p className="text-muted-foreground">Tap a highlight to see the fix</p>}
          {comments.length === 0 && <p className="text-muted-foreground">No comments to show.</p>}
          {groups.map((g) => (
            <div key={g.criterion} className="grid gap-2">
              <h4 className="flex items-center gap-1.5 font-medium">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", TONE_CLASSES[CRITERION_TONE[g.criterion]].dot)}
                />
                {CRITERION_LABELS[g.criterion]}
              </h4>
              <ul className="grid gap-1">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-comment-item={c.id}
                      onClick={() => onSelect(c.id, "list")}
                      className="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="whitespace-pre-wrap">{c.comment}</span>
                      {c.quote && (
                        <span className="whitespace-pre-wrap text-muted-foreground">“{c.quote}”</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {otherComments.length > 0 && (
            <section aria-labelledby={otherId} className="grid gap-2 border-t pt-4">
              <h4 id={otherId} className="font-medium">
                Other comments on this task
              </h4>
              <ul className="grid gap-3">
                {otherComments.map((c) => (
                  <li key={c.id} className="grid gap-1">
                    <CriterionChip comment={c} />
                    <p className="whitespace-pre-wrap">{c.comment}</p>
                    {c.quote && <p className="whitespace-pre-wrap text-muted-foreground">“{c.quote}”</p>}
                    {c.suggestion?.trim() ? (
                      <p className="whitespace-pre-wrap">
                        <span className="font-medium">Better: </span>
                        {c.suggestion}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
