"use client";

/**
 * A date-time in the viewer's locale and time zone. The server render may use
 * another zone; the client render corrects it, hence the suppressed warning.
 */
export function LocalTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}
