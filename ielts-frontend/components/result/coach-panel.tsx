"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Criterion } from "@/lib/api/types";
import { CRITERION_LABELS, CRITERION_TONE, STRENGTH_MARK, TONE_CLASSES } from "@/lib/result/format";
import type { SelectedComment, WritingFeedbackView } from "@/lib/result/writing-feedback";
import { cn } from "@/lib/utils";

function CriterionChip({ criterion }: { criterion: Criterion }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span aria-hidden="true" className={cn("size-2 rounded-full", TONE_CLASSES[CRITERION_TONE[criterion]].dot)} />
      {CRITERION_LABELS[criterion]}
    </span>
  );
}

function StrengthTag() {
  return (
    <span className="text-xs font-medium text-foreground">
      <span aria-hidden="true">✓ </span>Strength
    </span>
  );
}

function Fix({ comment: c }: { comment: SelectedComment }) {
  const { before, words, after } = c.excerpt;
  if (c.variant === "strength") {
    return (
      <article className="grid gap-3">
        <CriterionChip criterion={c.criterion} />
        <div className="grid gap-1 rounded-lg bg-state-correct/10 p-3">
          <p className="text-xs font-semibold tracking-wide text-foreground uppercase">
            <span aria-hidden="true">✓ </span>What works
          </p>
          <p className="whitespace-pre-wrap">
            {before}
            <mark className={cn("rounded-sm px-0.5", STRENGTH_MARK)}>{words}</mark>
            {after}
          </p>
        </div>
        <p className="whitespace-pre-wrap">{c.comment}</p>
      </article>
    );
  }
  const fix = c.variant === "fix";
  // Labels and text on the tints stay text-foreground: muted text drops below 4.5:1 there.
  // Without a suggestion there is nothing to replace (often the comment is praise), so the
  // words are marked in the criterion colour rather than struck out as a mistake.
  return (
    <article className="grid gap-3">
      <CriterionChip criterion={c.criterion} />
      <div className={cn("grid gap-1 rounded-lg p-3", fix ? "bg-state-wrong/10" : "bg-muted")}>
        <p className="text-xs font-semibold tracking-wide text-foreground uppercase">You wrote</p>
        <p className="whitespace-pre-wrap">
          {before}
          <mark
            className={cn(
              "rounded-sm px-0.5 text-foreground",
              fix
                ? "bg-state-wrong/25 line-through decoration-state-wrong decoration-2"
                : TONE_CLASSES[CRITERION_TONE[c.criterion]].mark,
            )}
          >
            {words}
          </mark>
          {after}
        </p>
        {c.variant === "legacy-no-change" && (
          <p className="text-xs text-foreground">No change suggested for these words.</p>
        )}
      </div>
      {c.rewrite !== null && (
        <div className="grid gap-1 rounded-lg bg-state-correct/10 p-3">
          <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Better</p>
          <p className="whitespace-pre-wrap">{c.rewrite}</p>
        </div>
      )}
      <p className="whitespace-pre-wrap">{c.comment}</p>
    </article>
  );
}

export function CoachPanel({
  taskNumber,
  feedback,
  onOpen,
  onNavigate,
  onClose,
}: {
  taskNumber: number;
  feedback: WritingFeedbackView;
  /** Opens a highlight from the comment list; `opener` is the list item's selector for refocus. */
  onOpen(key: string, opener: string): void;
  /** Previous/Next: moves within the open panel. */
  onNavigate(key: string): void;
  onClose(): void;
}) {
  const { selected, order, groups, other, visibleCount } = feedback;
  const headingId = useId();
  const otherId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<"prev" | "next" | null>(null);
  const selectedKey = selected?.key ?? null;

  // A new selection moves focus to the heading, except when Previous/Next stays usable.
  useEffect(() => {
    const nav = navRef.current;
    navRef.current = null;
    if (!selectedKey) return;
    const button = nav === "prev" ? prevRef.current : nav === "next" ? nextRef.current : null;
    if (button && !button.disabled) return;
    headingRef.current?.focus();
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      // Another overlay that handled Escape first marks it handled; leave the panel open then.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedKey, onClose]);

  const go = (dir: "prev" | "next", key: string | null) => {
    if (!key) return;
    navRef.current = dir;
    onNavigate(key);
  };

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
      {selected ? (
        <>
          <div className="flex items-center gap-2">
            <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
              Highlight {selected.position} of {selected.total}
            </h3>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </div>
          {selected.comments.map((c) => (
            <Fix key={c.id} comment={c} />
          ))}
          <div className="flex gap-2">
            <Button
              ref={prevRef}
              variant="outline"
              size="sm"
              disabled={selected.prevKey === null}
              onClick={() => go("prev", selected.prevKey)}
            >
              Previous
            </Button>
            <Button
              ref={nextRef}
              variant="outline"
              size="sm"
              disabled={selected.nextKey === null}
              onClick={() => go("next", selected.nextKey)}
            >
              Next
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
            Task {taskNumber} feedback
          </h3>
          {order.length > 0 && <p className="text-muted-foreground">Tap a highlight to see the feedback</p>}
          {visibleCount === 0 && <p className="text-muted-foreground">No comments to show.</p>}
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
                      onClick={() => onOpen(c.key, `[data-comment-item="${c.id}"]`)}
                      className="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {c.variant === "strength" && <StrengthTag />}
                      <span className="whitespace-pre-wrap">{c.comment}</span>
                      {c.quote && <span className="whitespace-pre-wrap text-muted-foreground">“{c.quote}”</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {other.length > 0 && (
            <section aria-labelledby={otherId} className="grid gap-2 border-t pt-4">
              <h4 id={otherId} className="font-medium">
                Other comments on this task
              </h4>
              <ul className="grid gap-3">
                {other.map((c) => (
                  <li key={c.id} className="grid gap-1">
                    <CriterionChip criterion={c.criterion} />
                    {c.variant === "strength" && <StrengthTag />}
                    <p className="whitespace-pre-wrap">{c.comment}</p>
                    {c.quote && <p className="whitespace-pre-wrap text-muted-foreground">“{c.quote}”</p>}
                    {c.suggestion !== null && (
                      <p className="whitespace-pre-wrap">
                        <span className="font-medium">Better: </span>
                        {c.suggestion}
                      </p>
                    )}
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
