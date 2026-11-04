import { expect, test } from "vitest";
import { isExpiringSoon, tokenExpiresAt } from "./jwt";

function makeToken(payload: Record<string, unknown>): string {
  const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url(JSON.stringify({ alg: "HS256" }))}.${b64url(JSON.stringify(payload))}.sig`;
}

const token = makeToken({ sub: "u1", exp: 1000 });

test("tokenExpiresAt decodes exp into epoch milliseconds", () => {
  expect(tokenExpiresAt(token)).toBe(1_000_000);
});

test("isExpiringSoon uses a 30 s skew", () => {
  expect(isExpiringSoon(token, 1_000_000 - 31_000)).toBe(false);
  expect(isExpiringSoon(token, 1_000_000 - 29_000)).toBe(true);
});

test("malformed or missing tokens count as expiring", () => {
  expect(tokenExpiresAt("garbage")).toBeNull();
  expect(isExpiringSoon("garbage")).toBe(true);
  expect(isExpiringSoon(undefined)).toBe(true);
  expect(isExpiringSoon(makeToken({ sub: "no-exp" }))).toBe(true);
});
