"use client";

import { useMemo, useState } from "react";
import { QuestionGroup } from "@/components/questions/question-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isAnswered } from "@/lib/answers/value";
import type { SessionDetail } from "@/lib/api/types";
import { flattenItems, readingItems } from "@/lib/content/items";
import type { ReadingContent } from "@/lib/content/schema";
import { useSubmitSession } from "@/lib/session/queries";
import { useSessionAnswers } from "@/lib/session/use-session-answers";
import { Countdown } from "./countdown";
import { QuestionNav } from "./question-nav";
import { SaveStatus } from "./save-status";
import { SubmitDialog } from "./submit-dialog";

type Props = {
  session: SessionDetail;
  content: ReadingContent;
  offsetMs: number;
  expired: boolean;
  onExpire(): void;
  onClosed(): void;
};

export function ReadingScreen({ session, content, offsetMs, expired, onExpire, onClosed }: Props) {
  const { answers, setAnswer, flush, status } = useSessionAnswers(session, { onClosed });
  const submit = useSubmitSession(session.id, flush);
  const [passageIndex, setPassageIndex] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);

  const items = useMemo(() => readingItems(content), [content]);
  const passageOf = useMemo(() => {
    const map = new Map<number, number>();
    content.passages.forEach((p, i) => {
      for (const item of flattenItems(p.question_groups)) map.set(item.key, i);
    });
    return map;
  }, [content]);

  const passage = content.passages[passageIndex];
  const unanswered = items.filter((item) => !isAnswered(answers[item.key])).length;

  function goToQuestion(key: number) {
    setPassageIndex(passageOf.get(key) ?? 0);
    // Wait for the passage's questions to render before scrolling.
    requestAnimationFrame(() =>
      document.getElementById(`q-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }),
    );
  }

  function handleExpire() {
    onExpire();
    // The server accepts saves for 30 s after the deadline: push what is pending now.
    void flush();
  }

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2">
          <h1 className="min-w-0 flex-1 truncate font-semibold">{session.title}</h1>
          <Badge variant="outline">{session.mode === "exam" ? "Exam" : "Practice"}</Badge>
          <SaveStatus status={status} />
          {session.deadline && (
            <Countdown deadline={session.deadline} offsetMs={offsetMs} onExpire={handleExpire} />
          )}
          <Button size="sm" onClick={() => setSubmitOpen(true)}>
            Submit
          </Button>
        </div>
        {expired && (
          <p role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            Time&apos;s up — submitting your answers…
          </p>
        )}
      </div>

      <Tabs
        value={String(passageIndex)}
        onValueChange={(v) => setPassageIndex(Number(v))}
        className="mx-auto w-full max-w-7xl px-4 pt-4"
      >
        <TabsList>
          {content.passages.map((p, i) => (
            <TabsTrigger key={p.number} value={String(i)}>
              Passage {p.number}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-4 lg:grid-cols-2">
        <article className="lg:max-h-[calc(100svh-12rem)] lg:overflow-y-auto lg:pr-4">
          <h2 className="text-lg font-semibold">{passage.title}</h2>
          <div className="mt-4 grid gap-4 text-[15px] leading-7">
            {passage.paragraphs.map((paragraph, i) => (
              <p key={i}>
                {paragraph.label && <strong className="mr-2">{paragraph.label}</strong>}
                {paragraph.text}
              </p>
            ))}
          </div>
        </article>
        <div className="grid content-start gap-10 lg:max-h-[calc(100svh-12rem)] lg:overflow-y-auto lg:pr-2">
          {passage.question_groups.map((group, i) => (
            <QuestionGroup key={`${passageIndex}-${i}`} group={group} answers={answers} onChange={setAnswer} />
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-2">
          <QuestionNav items={items} answers={answers} onSelect={goToQuestion} />
        </div>
      </div>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={(open) => {
          setSubmitOpen(open);
          if (!open) submit.reset();
        }}
        unanswered={unanswered}
        total={items.length}
        onConfirm={() => submit.mutate()}
        pending={submit.isPending}
        error={submit.error}
      />
    </div>
  );
}
