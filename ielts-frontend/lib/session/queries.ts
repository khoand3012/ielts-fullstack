"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/browser";
import { ApiError } from "@/lib/api/errors";
import type { SessionDetail, SessionMode, SessionRead } from "@/lib/api/types";
import { unwrap } from "@/lib/api/unwrap";
import { clockOffset } from "./clock";

export const sessionKey = (id: string) => ["session", id] as const;

export function useStartSession() {
  const router = useRouter();
  return useMutation<SessionDetail, ApiError, { test_id: string; mode: SessionMode }>({
    mutationFn: (body) => unwrap(api.POST("/sessions", { body })),
    // No cache seeding: the session screen refetches so its clock offset is fresh.
    onSuccess: (session) => router.push(`/sessions/${session.id}`),
  });
}

export type SessionData = { session: SessionDetail; offsetMs: number };

/**
 * The session with its content and saved answers, plus the server-clock offset
 * measured when the response arrived. Polls every 10 s while `poll` is set and
 * the session is still open (after the exam deadline, until the server submits).
 */
export function useSessionQuery(id: string, { poll = false }: { poll?: boolean } = {}) {
  return useQuery<SessionData, ApiError>({
    queryKey: sessionKey(id),
    queryFn: async () => {
      const session = await unwrap(
        api.GET("/sessions/{session_id}", { params: { path: { session_id: id } } }),
      );
      return { session, offsetMs: clockOffset(session.server_time, Date.now()) };
    },
    refetchInterval: (query) =>
      poll && query.state.data?.session.status === "in_progress" ? 10_000 : false,
    // A refetch must not happen behind the student's back mid-test.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (count, error) => (error.status === 0 || error.status >= 500) && count < 3,
  });
}

/** Thrown when answers could not be saved, so submitting would lose them. */
export class UnsavedAnswersError extends Error {
  constructor() {
    super("Your answers aren't saved yet — check your connection and try again.");
    this.name = "UnsavedAnswersError";
  }
}

export function useSubmitSession(id: string, flush: () => Promise<boolean>) {
  const queryClient = useQueryClient();
  return useMutation<SessionRead | null, ApiError | UnsavedAnswersError>({
    mutationFn: async () => {
      // Save what is still pending (e.g. text typed < 500 ms ago) before submitting.
      if (!(await flush())) throw new UnsavedAnswersError();
      try {
        return await unwrap(
          api.POST("/sessions/{session_id}/submit", { params: { path: { session_id: id } } }),
        );
      } catch (err) {
        // Already submitted (a second click, or the server's timeout).
        if (err instanceof ApiError && err.status === 409) return null;
        throw err;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKey(id) }),
  });
}
