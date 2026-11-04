// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { __resetRefreshCache, refreshTokens } from "./refresh";

const pair = { access_token: "a2", refresh_token: "r2", token_type: "bearer" };

function backend(status = 200, body: unknown = pair) {
  return vi.fn(
    async () =>
      new Promise<Response>((resolve) =>
        setTimeout(() => resolve(Response.json(body, { status })), 1),
      ),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

afterEach(() => __resetRefreshCache());

test("two concurrent calls with the same token make one request", async () => {
  const f = backend();
  const [a, b] = await Promise.all([refreshTokens("r1", f), refreshTokens("r1", f)]);
  expect(a).toEqual({ kind: "ok", pair: { access_token: "a2", refresh_token: "r2" } });
  expect(b).toEqual(a);
  expect(f).toHaveBeenCalledTimes(1);
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://localhost:8000/auth/refresh");
  expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "r1" });
});

test("a call within 10 s after settling reuses the result", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const f = backend();
  await refreshTokens("r1", f);
  vi.advanceTimersByTime(9_000);
  await refreshTokens("r1", f);
  expect(f).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2_000);
  await refreshTokens("r1", f);
  expect(f).toHaveBeenCalledTimes(2);
});

test("401 from backend means the token was rejected", async () => {
  const f = backend(401, { error: { code: "unauthorized", message: "x" } });
  await expect(refreshTokens("dead", f)).resolves.toEqual({ kind: "rejected" });
});

test("network failure means the backend is unavailable, not that the user is signed out", async () => {
  const f = vi.fn(async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await expect(refreshTokens("r1", f)).resolves.toEqual({ kind: "unavailable" });
});

test("5xx means unavailable and is not cached", async () => {
  const f = backend(503, { error: { code: "http_error", message: "down" } });
  await expect(refreshTokens("r1", f)).resolves.toEqual({ kind: "unavailable" });
  await refreshTokens("r1", f);
  expect(f).toHaveBeenCalledTimes(2);
});

test("different tokens refresh independently", async () => {
  const f = backend();
  await Promise.all([refreshTokens("r1", f), refreshTokens("other", f)]);
  expect(f).toHaveBeenCalledTimes(2);
});
