// @vitest-environment node
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { server } from "@/tests/msw/server";
import { POST as login } from "./login/route";
import { GET as signOutRedirect, POST as logout } from "./logout/route";
import { POST as register } from "./register/route";

const B = "http://localhost:8000";
const tokens = { access_token: "acc", refresh_token: "ref", token_type: "bearer" };
const creds = { email: "a@b.co", password: "password1" };

function post(path: string, body?: unknown, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("login success sets both httpOnly cookies", async () => {
  server.use(http.post(`${B}/auth/login`, () => HttpResponse.json(tokens)));
  const res = await login(post("/api/auth/login", creds));
  expect(res.status).toBe(204);
  expect(res.cookies.get("ielts_access")).toMatchObject({
    value: "acc",
    httpOnly: true,
    maxAge: 900,
    sameSite: "lax",
    path: "/",
  });
  expect(res.cookies.get("ielts_refresh")).toMatchObject({
    value: "ref",
    httpOnly: true,
    maxAge: 2592000,
  });
});

test("login failure passes status and body through and sets no cookies", async () => {
  const body = { error: { code: "unauthorized", message: "Invalid credentials", extra: {} } };
  server.use(http.post(`${B}/auth/login`, () => HttpResponse.json(body, { status: 401 })));
  const res = await login(post("/api/auth/login", creds));
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual(body);
  expect(res.cookies.get("ielts_access")).toBeUndefined();
});

test("register posts register then login", async () => {
  const calls: string[] = [];
  server.use(
    http.post(`${B}/auth/register`, async ({ request }) => {
      calls.push(`register:${JSON.stringify(await request.json())}`);
      return HttpResponse.json({ id: "u1", email: creds.email }, { status: 201 });
    }),
    http.post(`${B}/auth/login`, () => {
      calls.push("login");
      return HttpResponse.json(tokens);
    }),
  );
  const res = await register(post("/api/auth/register", creds));
  expect(res.status).toBe(204);
  expect(calls).toEqual([`register:${JSON.stringify(creds)}`, "login"]);
  expect(res.cookies.get("ielts_access")?.value).toBe("acc");
});

test("register failure is passed through without logging in", async () => {
  const body = { error: { code: "conflict", message: "Email already registered", extra: {} } };
  server.use(http.post(`${B}/auth/register`, () => HttpResponse.json(body, { status: 409 })));
  const res = await register(post("/api/auth/register", creds));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual(body);
});

test("logout clears both cookies even when the backend fails", async () => {
  let sent: unknown;
  server.use(
    http.post(`${B}/auth/logout`, async ({ request }) => {
      sent = await request.json();
      return new HttpResponse(null, { status: 500 });
    }),
  );
  const res = await logout(
    post("/api/auth/logout", undefined, "ielts_access=acc; ielts_refresh=ref"),
  );
  expect(res.status).toBe(204);
  expect(sent).toEqual({ refresh_token: "ref" });
  expect(res.cookies.get("ielts_access")).toMatchObject({ value: "", maxAge: 0 });
  expect(res.cookies.get("ielts_refresh")).toMatchObject({ value: "", maxAge: 0 });
});

test("GET logout clears cookies and redirects to login (used when the backend rejects a session)", async () => {
  server.use(http.post(`${B}/auth/logout`, () => new HttpResponse(null, { status: 204 })));
  const res = await signOutRedirect(
    new NextRequest("http://localhost:3000/api/auth/logout", {
      headers: { cookie: "ielts_access=acc; ielts_refresh=ref" },
    }),
  );
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  expect(res.cookies.get("ielts_refresh")).toMatchObject({ value: "", maxAge: 0 });
});
