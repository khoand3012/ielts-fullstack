import { BACKEND_URL } from "@/lib/env";

export type TokenPair = { access_token: string; refresh_token: string };

/**
 * `rejected` means the backend refused the token: the user is signed out.
 * `unavailable` means we could not tell (network error, 5xx): keep the cookies
 * so the next request can try again.
 */
export type RefreshResult =
  | { kind: "ok"; pair: TokenPair }
  | { kind: "rejected" }
  | { kind: "unavailable" };

// Refresh tokens rotate: the first use kills the old token. Requests that arrive
// together (or shortly after) carrying the same old token must share one refresh,
// otherwise every one but the first fails and logs the user out.
const RESULT_TTL_MS = 10_000;
const inflight = new Map<string, Promise<RefreshResult>>();

async function requestRefresh(refreshToken: string, fetchImpl: typeof fetch): Promise<RefreshResult> {
  try {
    const res = await fetchImpl(`${BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (res.status >= 500) return { kind: "unavailable" };
    if (!res.ok) return { kind: "rejected" };
    const body = (await res.json()) as Partial<TokenPair>;
    if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
      return { kind: "unavailable" };
    }
    return { kind: "ok", pair: { access_token: body.access_token, refresh_token: body.refresh_token } };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Exchanges a refresh token for a new pair. Concurrent callers share one request. */
export function refreshTokens(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;

  const promise = requestRefresh(refreshToken, fetchImpl);
  inflight.set(refreshToken, promise);
  void promise.then((result) => {
    const forget = () => {
      if (inflight.get(refreshToken) === promise) inflight.delete(refreshToken);
    };
    // An outage says nothing about the token, so the next request should try again.
    if (result.kind === "unavailable") forget();
    else setTimeout(forget, RESULT_TTL_MS);
  });
  return promise;
}

export function __resetRefreshCache() {
  inflight.clear();
}
