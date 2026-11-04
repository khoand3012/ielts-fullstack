// @vitest-environment node
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { afterEach, expect, test } from "vitest";
import { __resetRefreshCache } from "@/lib/auth/refresh";
import { server } from "@/tests/msw/server";
import { middleware } from "./middleware";

const B = "http://localhost:8000";

function jwt(expSeconds: number) {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u", exp: expSeconds })}.sig`;
}
const fresh = jwt(Math.floor(Date.now() / 1000) + 600);
const expiring = jwt(Math.floor(Date.now() / 1000) + 5);

function get(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : {});
}

afterEach(() => __resetRefreshCache());

test("protected page without cookies redirects to login with next", async () => {
  const res = await middleware(get("/tests?skill=reading"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(
    "http://localhost:3000/login?next=%2Ftests%3Fskill%3Dreading",
  );
});

test("proxy path without cookies gets a 401 JSON error", async () => {
  const res = await middleware(get("/api/backend/tests"));
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: { code: "unauthorized", message: "Not signed in", extra: {} },
  });
});

test("expiring access token is refreshed before rendering", async () => {
  server.use(
    http.post(`${B}/auth/refresh`, () =>
      HttpResponse.json({ access_token: "new-acc", refresh_token: "new-ref", token_type: "bearer" }),
    ),
  );
  const res = await middleware(get("/tests", `ielts_access=${expiring}; ielts_refresh=old-ref`));
  expect(res.headers.get("location")).toBeNull();
  expect(res.cookies.get("ielts_access")?.value).toBe("new-acc");
  expect(res.cookies.get("ielts_refresh")?.value).toBe("new-ref");
  // The rewritten request cookie header is what Server Components and the proxy will see.
  const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
  expect(forwarded).toContain("ielts_access=new-acc");
  expect(forwarded).toContain("ielts_refresh=new-ref");
});

test("failed refresh redirects to login and clears cookies", async () => {
  server.use(
    http.post(`${B}/auth/refresh`, () =>
      HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }),
    ),
  );
  const res = await middleware(get("/sessions", "ielts_refresh=dead"));
  expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fsessions");
  expect(res.cookies.get("ielts_refresh")).toMatchObject({ value: "", maxAge: 0 });
});

test("login page with a refresh cookie redirects to tests", async () => {
  const res = await middleware(get("/login", `ielts_access=${fresh}; ielts_refresh=r`));
  expect(res.headers.get("location")).toBe("http://localhost:3000/tests");
});

test("login page without cookies is public", async () => {
  const res = await middleware(get("/login"));
  expect(res.headers.get("location")).toBeNull();
  expect(res.status).toBe(200);
});

test("fresh access token passes through without calling the backend", async () => {
  // onUnhandledFrame: "error" would fail this test if a refresh request were made.
  const res = await middleware(get("/tests", `ielts_access=${fresh}; ielts_refresh=r`));
  expect(res.headers.get("location")).toBeNull();
  expect(res.cookies.get("ielts_access")).toBeUndefined();
});

test("a backend outage during refresh keeps the cookies and lets autosave retry", async () => {
  server.use(http.post(`${B}/auth/refresh`, () => new HttpResponse(null, { status: 503 })));
  const res = await middleware(get("/api/backend/sessions/s/answers", `ielts_access=${expiring}; ielts_refresh=still-valid`));
  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({ error: { code: "bad_gateway" } });
  expect(res.cookies.get("ielts_refresh")).toBeUndefined();
  expect(res.cookies.get("ielts_access")).toBeUndefined();
});

test("a backend outage during refresh on a page shows a retry page without signing out", async () => {
  server.use(http.post(`${B}/auth/refresh`, () => HttpResponse.error()));
  const res = await middleware(get("/sessions/s", `ielts_refresh=still-valid`));
  expect(res.status).toBe(503);
  expect(res.headers.get("location")).toBeNull();
  expect(res.cookies.get("ielts_refresh")).toBeUndefined();
});
