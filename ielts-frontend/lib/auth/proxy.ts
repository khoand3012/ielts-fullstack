import type { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/env";
import { passThrough, unreachable } from "./backend";
import { ACCESS_COOKIE, clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "./cookies";
import { refreshTokens, type TokenPair } from "./refresh";

async function forward(
  req: NextRequest,
  url: string,
  body: ArrayBuffer | undefined,
  accessToken: string | undefined,
): Promise<Response> {
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  return fetch(url, { method: req.method, headers, body, cache: "no-store" });
}

/**
 * Forwards /api/backend/<path> to the backend with the access token from the
 * cookie. On 401 it refreshes once (single-flight) and retries once.
 */
export async function proxyToBackend(req: NextRequest, path: string[]): Promise<NextResponse> {
  const url = `${BACKEND_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  try {
    let res = await forward(req, url, body, req.cookies.get(ACCESS_COOKIE)?.value);
    let refreshed: TokenPair | null = null;
    let refreshFailed = false;

    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
    if (res.status === 401 && refreshToken) {
      const result = await refreshTokens(refreshToken);
      // An outage is not a sign-out: keep the cookies so the client's retry can work.
      if (result.kind === "unavailable") return unreachable();
      if (result.kind === "ok") {
        refreshed = result.pair;
        res = await forward(req, url, body, refreshed.access_token);
      } else {
        refreshFailed = true;
      }
    }

    const out = await passThrough(res);
    if (refreshed) setAuthCookies(out.cookies, refreshed);
    if (refreshFailed) clearAuthCookies(out.cookies);
    return out;
  } catch {
    return unreachable();
  }
}
