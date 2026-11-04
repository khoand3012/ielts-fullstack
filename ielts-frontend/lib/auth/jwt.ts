/** The token's `exp` as epoch milliseconds, decoded without verifying the signature. */
export function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const { exp } = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the token is missing, unreadable, or expires within `skewMs`. */
export function isExpiringSoon(
  token: string | undefined,
  now: number = Date.now(),
  skewMs = 30_000,
): boolean {
  if (!token) return true;
  const expiresAt = tokenExpiresAt(token);
  return expiresAt === null || expiresAt - now < skewMs;
}
