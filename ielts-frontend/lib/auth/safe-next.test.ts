import { expect, test } from "vitest";
import { safeNext } from "./safe-next";

test("keeps same-site relative paths", () => {
  expect(safeNext("/sessions/1")).toBe("/sessions/1");
  expect(safeNext("/tests?skill=reading")).toBe("/tests?skill=reading");
});

test("rejects paths that browsers normalize into another origin", () => {
  // URL parsers strip tabs and newlines, so "/\t/evil.com" becomes "//evil.com".
  for (const bad of ["/\t/evil.com", "/\n/evil.com", "/\r//evil.com", "/\\/evil.com"]) {
    expect(safeNext(bad)).toBe("/tests");
  }
});

test("rejects anything that could leave the site", () => {
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "", null, undefined]) {
    expect(safeNext(bad)).toBe("/tests");
  }
});

test("rejects dot segments that normalize to a protocol-relative URL", () => {
  for (const bad of ["/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e//evil.com"]) {
    expect(safeNext(bad)).toBe("/tests");
  }
});
