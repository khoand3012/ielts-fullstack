import { expect, test } from "vitest";
import { ApiError, toApiError } from "./errors";

test("reads the backend's error envelope", () => {
  const err = toApiError(429, {
    error: { code: "quota_exceeded", message: "m", extra: { resets_at: "2026-10-25T00:00:00Z" } },
  });
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({
    status: 429,
    code: "quota_exceeded",
    message: "m",
    extra: { resets_at: "2026-10-25T00:00:00Z" },
  });
});

test("reads FastAPI's default validation shape", () => {
  const err = toApiError(422, {
    detail: [{ loc: ["body", "mode"], msg: "Input should be 'practice' or 'exam'", type: "enum" }],
  });
  expect(err).toMatchObject({
    status: 422,
    code: "validation_error",
    message: "Input should be 'practice' or 'exam'",
  });
});

test("falls back to http_error for unknown bodies", () => {
  expect(toApiError(502, "<html>")).toMatchObject({ status: 502, code: "http_error" });
});

test("missing extra becomes an empty object", () => {
  expect(toApiError(409, { error: { code: "session_closed", message: "x" } }).extra).toEqual({});
});
