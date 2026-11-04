"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SaveQueue, type SaveStatus } from "@/lib/answers/save-queue";
import { normalizeSaved, type AnswerValue } from "@/lib/answers/value";
import { api } from "@/lib/api/browser";
import type { SessionDetail } from "@/lib/api/types";
import { unwrap } from "@/lib/api/unwrap";

const UNSAVED: ReadonlySet<SaveStatus> = new Set(["pending", "saving", "retrying"]);

/**
 * Local answer state for a session plus its autosave queue. Local state is what
 * the inputs show; the server's response only fills in questions with no
 * unsaved edit, so a slow response never overwrites newer typing.
 */
export function useSessionAnswers(session: SessionDetail, handlers: { onClosed(): void }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<number, AnswerValue>>(() =>
    normalizeSaved(session.answers),
  );
  const [status, setStatus] = useState<SaveStatus>("saved");
  const queueRef = useRef<SaveQueue | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const sessionId = session.id;

  // Created and disposed in one effect so StrictMode's mount/unmount/mount
  // leaves a live queue.
  useEffect(() => {
    const put = (batch: { question: number; value: AnswerValue }[], keepalive = false) =>
      api.PUT("/sessions/{session_id}/answers", {
        params: { path: { session_id: sessionId } },
        body: { answers: batch },
        keepalive,
      });
    const queue = new SaveQueue({
      send: async (batch) => (await unwrap(put(batch))).answers,
      // keepalive lets the request outlive the page if the student is leaving the site.
      sendOnDispose: (batch) => void put(batch, true).catch(() => {}),
      onSaved: (saved) => {
        const accepted: Record<number, AnswerValue> = {};
        for (const [question, value] of Object.entries(saved)) {
          if (!queue.hasPending(Number(question))) accepted[Number(question)] = value;
        }
        setAnswers((prev) => ({ ...prev, ...accepted }));
      },
      onStatus: setStatus,
      onClosed: () => handlersRef.current.onClosed(),
      onRejected: (question, message) =>
        toast.error(
          question === null
            ? `Some answers weren't saved: ${message}`
            : `Answer to question ${question} wasn't saved: ${message}`,
        ),
      onFatal: (error) => {
        if (error.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        } else {
          toast.error("Your answers can't be saved right now. Reload the page.");
        }
      },
    });
    queueRef.current = queue;
    // The retry backoff can be up to 15 s; don't make a student near the deadline wait for it.
    const onOnline = () => void queue.flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [sessionId, router]);

  useEffect(() => {
    if (!UNSAVED.has(status)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const setAnswer = useCallback(
    (question: number, value: AnswerValue, opts: { debounce: boolean }) => {
      setAnswers((prev) => ({ ...prev, [question]: value }));
      queueRef.current?.set(question, value, opts);
    },
    [],
  );

  const flush = useCallback(() => queueRef.current?.flush() ?? Promise.resolve(true), []);

  return { answers, setAnswer, flush, status };
}
