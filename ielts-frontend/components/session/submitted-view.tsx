"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { SessionRead } from "@/lib/api/types";

type Props = {
  session: SessionRead;
  /** Typed text the server never stored, by task number; kept on screen so it can be copied. */
  unsavedText?: Record<number, string>;
  /** Set by the previous screen's unmount, which runs before this view's first effect. */
  unsavedRef?: RefObject<Record<number, string> | null>;
};

/** Shown for an instant: a submitted session is sent on to its result page. */
export function SubmittedView({ session, unsavedText, unsavedRef }: Props) {
  const router = useRouter();
  const resultHref = `/sessions/${session.id}/result`;
  const [copyFailed, setCopyFailed] = useState<Record<string, boolean>>({});
  const boxes = useRef<Record<string, HTMLTextAreaElement | null>>({});

  async function copy(task: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed((prev) => ({ ...prev, [task]: false }));
    } catch {
      // Insecure context or denied permission: select the text so Ctrl+C works.
      boxes.current[task]?.focus();
      boxes.current[task]?.select();
      setCopyFailed((prev) => ({ ...prev, [task]: true }));
    }
  }

  const lost = Object.entries(unsavedText ?? {}).filter(([, text]) => text.trim() !== "");
  const hasLost = lost.length > 0;
  useEffect(() => {
    if (hasLost || unsavedRef?.current) return;
    router.replace(resultHref);
  }, [router, resultHref, hasLost, unsavedRef]);

  const timedOut = session.submit_reason === "timeout";
  return (
    <main className={hasLost ? "mx-auto max-w-2xl px-4 py-12" : "mx-auto max-w-md px-4 py-16 text-center"}>
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{session.title}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {timedOut ? "Time's up — submitted" : "Submitted"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {timedOut && "Your saved answers were submitted when time ran out. "}
          {hasLost ? "Your session is closed." : "Taking you to your result…"}
        </p>
      </div>

      {hasLost && (
        <section className="mt-6 grid gap-6 text-left">
          <p
            role="alert"
            className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          >
            Your last typing was not saved before the session closed. Copy it below to keep it.
          </p>
          {lost.map(([task, text]) => (
            <div key={task} className="grid gap-2">
              <label htmlFor={`lost-task-${task}`} className="text-sm font-medium">
                {`Task ${task} text`}
              </label>
              <textarea
                id={`lost-task-${task}`}
                readOnly
                ref={(el) => {
                  boxes.current[task] = el;
                }}
                value={text}
                rows={12}
                className="w-full rounded-lg border bg-background p-3 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => void copy(task, text)}
              >
                {`Copy Task ${task} text`}
              </Button>
              {copyFailed[task] && (
                <p role="status" className="text-sm text-muted-foreground">
                  Press Ctrl+C to copy
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="mt-8 flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/sessions">My sessions</Link>
        </Button>
        <Button asChild>
          <Link href={resultHref}>View result</Link>
        </Button>
      </div>
    </main>
  );
}
