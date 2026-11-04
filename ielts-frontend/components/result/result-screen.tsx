"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { SessionResult } from "@/lib/api/types";
import { useResultQuery } from "@/lib/result/queries";
import { fixNextForQuestions } from "@/lib/result/question-stats";
import { QuestionGrid } from "./question-grid";
import { ResultHero } from "./result-hero";
import { WritingResultView } from "./writing-result";

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
      <Button asChild variant="outline" className="mt-6">
        <Link href="/sessions">My sessions</Link>
      </Button>
    </main>
  );
}

function fixNextFor(result: SessionResult): string[] {
  if (result.writing) return result.writing.focus.slice(0, 3);
  if (result.questions) return fixNextForQuestions(result.questions);
  return [];
}

function Body({
  result,
  timedOut,
  onCheckAgain,
}: {
  result: SessionResult;
  timedOut: boolean;
  onCheckAgain: () => void;
}) {
  if (result.writing) return <WritingResultView writing={result.writing} />;

  if (result.status === "being_graded") {
    if (timedOut) {
      return (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="font-medium">
            This is taking longer than expected. You can leave this page - check My sessions later.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button asChild variant="outline">
              <Link href="/sessions">My sessions</Link>
            </Button>
            <Button onClick={onCheckAgain}>Check again</Button>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="font-medium">Your result is being graded</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This page updates by itself — you can leave it open or come back later from My sessions.
        </p>
      </div>
    );
  }

  if (result.questions && (result.skill === "reading" || result.skill === "listening")) {
    return <QuestionGrid questions={result.questions} sections={result.sections ?? null} skill={result.skill} />;
  }

  return (
    <p className="text-sm text-muted-foreground">
      A question-by-question review isn&apos;t available for this attempt.
    </p>
  );
}

type ResultQueryState = ReturnType<typeof useResultQuery>;

/** Always mounted (empty at first) so changes to its text are announced. */
function LiveStatus({ status }: { status: SessionResult["status"] | undefined }) {
  const text =
    status === "being_graded"
      ? "Your result is being graded."
      : status === "graded"
        ? "Your result is ready."
        : "";
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}

export function ResultScreen({ sessionId }: { sessionId: string }) {
  const query = useResultQuery(sessionId);
  return (
    <>
      <LiveStatus status={query.data?.status} />
      <ResultContent sessionId={sessionId} query={query} />
    </>
  );
}

function ResultContent({ sessionId, query }: { sessionId: string; query: ResultQueryState }) {
  const router = useRouter();
  const conflict = query.isError && query.error.status === 409;

  // Still in progress: there is nothing to show yet, go back to the test.
  useEffect(() => {
    if (conflict) router.replace(`/sessions/${sessionId}`);
  }, [conflict, router, sessionId]);

  if (conflict) {
    return (
      <Message title="This test is still in progress">
        <p className="mt-2 text-sm text-muted-foreground">Taking you back to it…</p>
      </Message>
    );
  }

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8" aria-busy="true">
        <div className="h-7 w-72 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-24 animate-pulse rounded-xl bg-muted" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-muted" />
      </main>
    );
  }

  if (query.isError && !query.data) {
    if (query.error.status === 404) return <Message title="Result not found" />;
    return (
      <Message title="Couldn't load this result">
        <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button className="mt-4" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </Message>
    );
  }

  const result = query.data;
  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-4 py-8">
      {query.isError && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-4 py-2 text-sm">
          {"Couldn't refresh this result. "}
          <button type="button" className="font-medium underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}
      <ResultHero result={result} fixNext={fixNextFor(result)} />
      <Body result={result} timedOut={query.timedOut} onCheckAgain={query.checkAgain} />
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/sessions">My sessions</Link>
        </Button>
        <Button asChild>
          <Link href="/tests">Back to tests</Link>
        </Button>
      </div>
    </main>
  );
}
