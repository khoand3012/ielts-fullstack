"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Criterion, WritingResult, WritingTask } from "@/lib/api/types";
import { ContentError, parseContent } from "@/lib/content/schema";
import { useSessionQuery } from "@/lib/session/queries";
import { formatBand } from "@/lib/result/format";
import { writingFeedback } from "@/lib/result/writing-feedback";
import { cn } from "@/lib/utils";
import { CoachPanel } from "./coach-panel";
import { CriterionBars } from "./criterion-bars";
import { HighlightedEssay } from "./highlighted-essay";

const highlightSelector = (key: string) => `[data-highlight="${key}"]`;

function TaskView({ task }: { task: WritingTask }) {
  const [filter, setFilter] = useState<Criterion | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const feedback = useMemo(() => writingFeedback(task, { filter, selectedKey }), [task, filter, selectedKey]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Selector for the element that opened the panel; Previous/Next keep it.
  const openerRef = useRef<string | null>(null);
  // Where focus goes once the panel has closed: the opener, else the current highlight.
  const refocusRef = useRef<string[] | null>(null);

  const open = (key: string, opener: string) => {
    openerRef.current = opener;
    setSelectedKey(key);
  };

  const close = useCallback(() => {
    refocusRef.current = [openerRef.current, selectedKey && highlightSelector(selectedKey)].filter(
      (s): s is string => !!s,
    );
    openerRef.current = null;
    setSelectedKey(null);
  }, [selectedKey]);

  // Bring the selected highlight into view: a list item or Previous/Next may point
  // off-screen, and on phones the bottom sheet covers the lower part of the essay.
  useEffect(() => {
    if (selectedKey === null) return;
    rootRef.current?.querySelector(highlightSelector(selectedKey))?.scrollIntoView?.({ block: "center" });
  }, [selectedKey]);

  useEffect(() => {
    const targets = refocusRef.current;
    if (selectedKey !== null || !targets) return;
    refocusRef.current = null;
    for (const target of targets) {
      const el = rootRef.current?.querySelector<HTMLElement>(target);
      if (el) {
        el.focus();
        return;
      }
    }
  }, [selectedKey]);

  if (task.band === null) {
    return <p className="text-muted-foreground">Not graded: no answer</p>;
  }

  return (
    <div ref={rootRef} className={cn("grid gap-4", feedback.selected && "max-lg:pb-[60vh]")}>
      <CriterionBars
        criteria={task.criteria}
        active={filter}
        onToggle={(c) => {
          setFilter((f) => (f === c ? null : c));
          openerRef.current = null;
          setSelectedKey(null);
        }}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">
          {feedback.blank ? (
            <p className="text-muted-foreground">No answer</p>
          ) : (
            <HighlightedEssay paragraphs={feedback.paragraphs} onOpen={(key) => open(key, highlightSelector(key))} />
          )}
        </div>
        <CoachPanel
          taskNumber={task.number}
          feedback={feedback}
          // The list unmounts while a highlight is shown, so the opener is the item's selector.
          onOpen={open}
          onNavigate={setSelectedKey}
          onClose={close}
        />
      </div>
    </div>
  );
}

/** Task number -> minimum words. Empty while the session is loading, failed, or unparseable. */
function useMinWords(sessionId: string): Map<number, number> {
  const { data } = useSessionQuery(sessionId);
  return useMemo(() => {
    const mins = new Map<number, number>();
    if (!data) return mins;
    try {
      const parsed = parseContent("writing", data.session.content);
      if (parsed.skill === "writing") {
        for (const t of parsed.content.tasks) mins.set(t.number, t.min_words);
      }
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
    }
    return mins;
  }, [data]);
}

export function WritingResultView({
  writing,
  sessionId,
}: {
  writing: WritingResult;
  sessionId: string;
}) {
  const minWords = useMinWords(sessionId);
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
              {writing.tasks.map((t) => {
                const min = minWords.get(t.number);
                const under = min !== undefined && t.word_count > 0 && t.word_count < min;
                return (
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
                    {/* The space keeps the chip a separate phrase in the tab's accessible name. */}
                    {under && (
                      <>
                        {" "}
                        <span className="mt-0.5 rounded-full border border-state-partial bg-state-partial/15 px-2 text-xs font-medium text-foreground">
                          Under {min} words
                        </span>
                      </>
                    )}
                  </TabsTrigger>
                );
              })}
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
