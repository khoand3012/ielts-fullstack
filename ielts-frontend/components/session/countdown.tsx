"use client";

import { useEffect, useRef, useState } from "react";
import { formatRemaining, remainingMs } from "@/lib/session/clock";
import { cn } from "@/lib/utils";

type Props = {
  deadline: string;
  offsetMs: number;
  onExpire(): void;
};

/**
 * Display-only exam countdown on the server's clock. It never gates anything:
 * the server decides when the session ends.
 */
export function Countdown({ deadline, offsetMs, onExpire }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = remainingMs(deadline, offsetMs, now);

  useEffect(() => {
    if (remaining === 0 && !expired.current) {
      expired.current = true;
      onExpireRef.current();
    }
  }, [remaining]);

  const urgency = remaining < 60_000 ? "critical" : remaining < 5 * 60_000 ? "warning" : "normal";

  return (
    <span
      role="timer"
      aria-live="off"
      aria-label="Time remaining"
      data-urgency={urgency}
      className={cn(
        "rounded-md px-2 py-1 font-mono text-sm tabular-nums",
        urgency === "warning" && "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
        urgency === "critical" && "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
      )}
    >
      {formatRemaining(remaining)}
    </span>
  );
}
