/** Server clock minus client clock, measured when the response arrived. */
export function clockOffset(serverTime: string, receivedAt: number): number {
  return Date.parse(serverTime) - receivedAt;
}

/** Time left until `deadline` on the server's clock; never negative. */
export function remainingMs(deadline: string, offsetMs: number, now: number = Date.now()): number {
  return Math.max(0, Date.parse(deadline) - (now + offsetMs));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "mm:ss" under an hour, "h:mm:ss" otherwise; rounds up so 00:00 means time's up. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
