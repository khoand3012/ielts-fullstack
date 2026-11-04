import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { server } from "@/tests/msw/server";
import { api } from "./browser";
import { ApiError } from "./errors";
import { unwrap } from "./unwrap";

const ok = (status: number) => new Response(null, { status });

test("resolves data", async () => {
  await expect(unwrap(Promise.resolve({ data: { a: 1 }, response: ok(200) }))).resolves.toEqual({
    a: 1,
  });
});

test("throws ApiError with the response status when error is set", async () => {
  const p = unwrap(
    Promise.resolve({
      error: { error: { code: "not_found", message: "Not found" } },
      response: ok(404),
    }),
  );
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ status: 404, code: "not_found" });
});

test("turns a network failure into ApiError(0, network)", async () => {
  await expect(unwrap(Promise.reject(new TypeError("fetch failed")))).rejects.toMatchObject({
    status: 0,
    code: "network",
  });
});

test("the browser client reaches the proxy with an absolute URL", async () => {
  server.use(
    http.get("*/api/backend/tests", () => HttpResponse.json({ items: [], total: 0 })),
  );
  await expect(unwrap(api.GET("/tests"))).resolves.toEqual({ items: [], total: 0 });
});
