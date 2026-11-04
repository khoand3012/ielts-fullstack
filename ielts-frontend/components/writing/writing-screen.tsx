"use client";

import { useRef, useState } from "react";
import { Countdown } from "@/components/session/countdown";
import { SaveStatus } from "@/components/session/save-status";
import { SubmitDialog } from "@/components/session/submit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAnswered, type AnswerValue } from "@/lib/answers/value";
import type { SessionDetail } from "@/lib/api/types";
import type { WritingContent } from "@/lib/content/schema";
import { useSubmitSession } from "@/lib/session/queries";
import { useSessionAnswers } from "@/lib/session/use-session-answers";
import { unsavedTexts } from "@/lib/writing/unsaved";
import { TaskEditor } from "./task-editor";

type Props = {
  session: SessionDetail;
  content: WritingContent;
  offsetMs: number;
  expired: boolean;
  onExpire(): void;
  onClosed(): void;
  /** Called, before onClosed, with typed text the server never stored. */
  onLostText?(text: Record<number, string>): void;
};

function emptyNotice(numbers: number[]): string | undefined {
  if (numbers.length === 0) return undefined;
  const names = numbers.map((n) => `Task ${n}`).join(" and ");
  return `${names} ${numbers.length === 1 ? "is" : "are"} empty`;
}

export function WritingScreen({ session, content, offsetMs, expired, onExpire, onClosed, onLostText }: Props) {
  const answersRef = useRef<Record<number, AnswerValue>>({});
  const handleClosed = () => {
    // Hand over text the server never stored before the screen is replaced.
    const lost = unsavedTexts(answersRef.current, session.answers);
    if (Object.keys(lost).length > 0) onLostText?.(lost);
    onClosed();
  };
  const { answers, setAnswer, flush, status } = useSessionAnswers(session, { onClosed: handleClosed });
  answersRef.current = answers;
  const submit = useSubmitSession(session.id, flush);
  const [submitOpen, setSubmitOpen] = useState(false);

  const empty = content.tasks.filter((task) => !isAnswered(answers[task.number])).map((t) => t.number);

  function handleExpire() {
    onExpire();
    // The server accepts saves for 30 s after the deadline: push what is pending now.
    void flush();
  }

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-2">
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

      <div className="mx-auto grid w-full max-w-4xl gap-12 px-4 py-6">
        {content.tasks.map((task) => {
          const saved = answers[task.number];
          return (
            <TaskEditor
              key={task.number}
              task={task}
              value={typeof saved === "string" ? saved : ""}
              onChange={(v) => setAnswer(task.number, v, { debounce: true })}
            />
          );
        })}
      </div>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={(open) => {
          setSubmitOpen(open);
          if (!open) submit.reset();
        }}
        unanswered={0}
        total={content.tasks.length}
        notice={emptyNotice(empty)}
        onConfirm={() => submit.mutate()}
        pending={submit.isPending}
        error={submit.error}
      />
    </div>
  );
}
