// @vitest-environment node
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { afterEach, expect, test } from "vitest";
import { server } from "@/tests/msw/server";
import { proxyToBackend } from "./proxy";
import { __resetRefreshCache } from "./refresh";

const B = "http://localhost:8000";

afterEach(() => __resetRefreshCache());

function req(method: string, path: string, body?: unknown, cookie = "ielts_access=acc; ielts_refresh=ref") {
  return new NextRequest(`http://localhost:3000/api/backend${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("forwards method, query, body and Bearer header", async () => {
  let seen: { url: string; auth: string | null; body: unknown } | undefined;
  server.use(
    http.put(`${B}/sessions/abc/answers`, async ({ request }) => {
      seen = {
        url: request.url,
        auth: request.headers.get("authorization"),
        body: await request.json(),
      };
      return HttpResponse.json({ answers: { "1": ["A"] } });
    }),
  );
  const body = { answers: [{ question: 1, value: ["A"] }] };
  const res = await proxyToBackend(req("PUT", "/sessions/abc/answers?x=1", body), [
    "sessions",
    "abc",
    "answers",
  ]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ answers: { "1": ["A"] } });
  expect(seen).toEqual({ url: `${B}/sessions/abc/answers?x=1`, auth: "Bearer acc", body });
});

test("passes a 409 body through untouched", async () => {
  const body = { error: { code: "session_closed", message: "closed", extra: {} } };
  server.use(http.post(`${B}/sessions/abc/submit`, () => HttpResponse.json(body, { status: 409 })));
  const res = await proxyToBackend(req("POST", "/sessions/abc/submit"), ["sessions", "abc", "submit"]);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual(body);
});

test("on 401 refreshes once, retries, and sets both cookies", async () => {
  const auths: (string | null)[] = [];
  server.use(
    http.get(`${B}/tests`, ({ request }) => {
      const auth = request.headers.get("authorization");
      auths.push(auth);
      return auth === "Bearer acc2"
        ? HttpResponse.json({ items: [], total: 0 })
        : HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 });
    }),
    http.post(`${B}/auth/refresh`, () =>
      HttpResponse.json({ access_token: "acc2", refresh_token: "ref2", token_type: "bearer" }),
    ),
  );
  const res = await proxyToBackend(req("GET", "/tests"), ["tests"]);
  expect(res.status).toBe(200);
  expect(auths).toEqual(["Bearer acc", "Bearer acc2"]);
  expect(res.cookies.get("ielts_access")?.value).toBe("acc2");
  expect(res.cookies.get("ielts_refresh")?.value).toBe("ref2");
});

test("refresh failure returns 401 and clears cookies", async () => {
  server.use(
    http.get(`${B}/tests`, () =>
      HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }),
    ),
    http.post(`${B}/auth/refresh`, () =>
      HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }),
    ),
  );
  const res = await proxyToBackend(req("GET", "/tests"), ["tests"]);
  expect(res.status).toBe(401);
  expect(res.cookies.get("ielts_access")).toMatchObject({ value: "", maxAge: 0 });
  expect(res.cookies.get("ielts_refresh")).toMatchObject({ value: "", maxAge: 0 });
});

test("a retry that also returns 401 does not loop", async () => {
  let hits = 0;
  server.use(
    http.get(`${B}/tests`, () => {
      hits += 1;
      return HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 });
    }),
    http.post(`${B}/auth/refresh`, () =>
      HttpResponse.json({ access_token: "acc2", refresh_token: "ref2", token_type: "bearer" }),
    ),
  );
  const res = await proxyToBackend(req("GET", "/tests"), ["tests"]);
  expect(res.status).toBe(401);
  expect(hits).toBe(2);
});

test("a backend outage during refresh returns 502 and keeps the cookies", async () => {
  server.use(
    http.get(`${B}/tests`, () =>
      HttpResponse.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }),
    ),
    http.post(`${B}/auth/refresh`, () => new HttpResponse(null, { status: 502 })),
  );
  const res = await proxyToBackend(req("GET", "/tests"), ["tests"]);
  expect(res.status).toBe(502);
  expect(res.cookies.get("ielts_access")).toBeUndefined();
  expect(res.cookies.get("ielts_refresh")).toBeUndefined();
});
