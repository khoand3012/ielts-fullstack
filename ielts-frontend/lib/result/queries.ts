"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/browser";
import type { ApiError } from "@/lib/api/errors";
import type { SessionResult } from "@/lib/api/types";
import { unwrap } from "@/lib/api/unwrap";

export const resultKey = (id: string) => ["session", id, "result"] as const;

const FIRST_POLL_MS = 3_000;
const MAX_POLL_MS = 15_000;
/** Total time to keep polling a result that stays "being graded". */
export const POLL_CAP_MS = 10 * 60_000;

/** Delay before poll number `pollIndex` (0 = the first): 3 s, then 20% slower each time, capped at 15 s. */
export function pollDelay(pollIndex: number): number {
  return Math.min(FIRST_POLL_MS * 1.2 ** pollIndex, MAX_POLL_MS);
}

/** Client errors (409 still in progress, 404, 403...) won't fix themselves by retrying. */
const isTransient = (error: ApiError) => error.status === 0 || error.status >= 500;

/**
 * The session's result. While it is still being graded, polls with a growing
 * delay; react-query pauses the interval while the tab is hidden. Polling
 * stops once graded, on an error that retrying cannot fix, or after
 * POLL_CAP_MS (`timedOut`); `checkAgain` starts a fresh polling window.
 */
export function useResultQuery(id: string) {
  const [windowStart, setWindowStart] = useState(() => Date.now());

  const query = useQuery<SessionResult, ApiError>({
    queryKey: resultKey(id),
    queryFn: () =>
      unwrap(api.GET("/sessions/{session_id}/result", { params: { path: { session_id: id } } })),
    refetchInterval: (q) => {
      if (q.state.data?.status !== "being_graded") return false;
      if (q.state.error && !isTransient(q.state.error)) return false;
      if (Date.now() - windowStart >= POLL_CAP_MS) return false;
      // dataUpdateCount is 1 after the first fetch, so the first poll waits 3 s.
      return pollDelay(Math.max(0, q.state.dataUpdateCount - 1));
    },
    refetchIntervalInBackground: false,
    retry: (count, error) => isTransient(error) && count < 3,
  });

  const timedOut =
    query.data?.status === "being_graded" && query.dataUpdatedAt - windowStart >= POLL_CAP_MS;

  const checkAgain = () => {
    setWindowStart(Date.now());
    void query.refetch();
  };

  return { ...query, timedOut, checkAgain };
}
