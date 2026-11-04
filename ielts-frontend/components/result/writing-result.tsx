"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Criterion, WritingResult, WritingTask } from "@/lib/api/types";
import { formatBand } from "@/lib/result/format";
import { type FeedbackComment, placeComments } from "@/lib/result/highlights";
import { cn } from "@/lib/utils";
import { CoachPanel } from "./coach-panel";
import { CriterionBars } from "./criterion-bars";
import { HighlightedEssay, commentsOn, findHighlight } from "./highlighted-essay";

function TaskView({ task }: { task: WritingTask }) {
  const comments = useMemo<FeedbackComment[]>(
    () =>
      task.criteria.flatMap((c) =>
        c.comments.map((x, i) => ({
          id: `${c.criterion}-${i}`,
          criterion: c.criterion,
          comment: x.comment,
          quote: x.quote,
          suggestion: x.suggestion,
        })),
      ),
    [task.criteria],
  );
  const placed = useMemo(() => placeComments(task.text, comments), [task.text, comments]);
  const [filter, setFilter] = useState<Criterion | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const essayRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const key = selectedId ? findHighlight(placed, selectedId)?.key : undefined;
    setSelectedId(null);
    if (key) essayRef.current?.querySelector<HTMLElement>(`[data-highlight="${key}"]`)?.focus();
  }, [placed, selectedId]);

  if (task.band === null) {
    return <p className="text-muted-foreground">Not graded: no answer</p>;
  }

  const shownComments = filter ? comments.filter((c) => c.criterion === filter) : comments;
  const order = placed.paragraphs.flatMap((p) =>
    p.highlights.flatMap((h) => commentsOn(h, comments, filter).slice(0, 1).map((c) => c.id)),
  );
  const blank = task.text.trim() === "";

  return (
    <div className={cn("grid gap-4", selectedId && "max-lg:pb-[60vh]")}>
      <CriterionBars
        criteria={task.criteria}
        active={filter}
        onToggle={(c) => {
          setFilter((f) => (f === c ? null : c));
          setSelectedId(null);
        }}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div ref={essayRef} className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">
          {blank ? (
            <p className="text-muted-foreground">No answer</p>
          ) : (
            <HighlightedEssay
              placed={placed}
              comments={comments}
              filter={filter}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <CoachPanel
          task={task}
          placed={placed}
          comments={shownComments}
          selectedId={selectedId}
          order={order}
          onSelect={setSelectedId}
          onClose={close}
        />
      </div>
    </div>
  );
}

export function WritingResultView({ writing }: { writing: WritingResult }) {
  // The hero's "Fix these next" shows the first three focus items.
  const moreFocus = writing.focus.slice(3);
  const first = writing.tasks[0];
  return (
    <div className="grid gap-6">
      <section aria-labelledby="essay-feedback-heading" className="grid gap-4">
        <h2 id="essay-feedback-heading" className="text-lg font-semibold">
          Essay feedback
        </h2>
        {first && (
          <Tabs defaultValue={String(first.number)}>
            {/* Word count stacks under the band so two tabs fit a 360px screen. */}
            <TabsList className="group-data-horizontal/tabs:h-auto">
              {writing.tasks.map((t) => (
                <TabsTrigger
                  key={t.number}
                  value={String(t.number)}
                  className="h-auto flex-col gap-0 px-4 py-1"
                >
                  <span>
                    Task {t.number} · {formatBand(t.band)}
                  </span>{" "}
                  <span className="text-xs font-normal tabular-nums">
                    {t.word_count} {t.word_count === 1 ? "word" : "words"}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            {/* Radix unmounts inactive panels, so switching task resets the filter and selection. */}
            {writing.tasks.map((t) => (
              <TabsContent key={t.number} value={String(t.number)} className="pt-2 text-base">
                <TaskView task={t} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </section>
      {moreFocus.length > 0 && (
        <section aria-labelledby="more-focus-heading" className="grid gap-2">
          <h2 id="more-focus-heading" className="text-lg font-semibold">
            More to focus on
          </h2>
          <ol start={4} className="grid list-decimal gap-1 pl-5 text-sm">
            {moreFocus.map((f, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {f}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
