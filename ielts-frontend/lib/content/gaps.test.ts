import { expect, test } from "vitest";
import { parseGapContext } from "./gaps";

test("splits text around {n} markers", () => {
  expect(parseGapContext("find {8} in them, and {9}.")).toEqual([
    { kind: "text", text: "find " },
    { kind: "gap", number: 8 },
    { kind: "text", text: " in them, and " },
    { kind: "gap", number: 9 },
    { kind: "text", text: "." },
  ]);
});

test("a leading or trailing marker yields no empty text tokens", () => {
  expect(parseGapContext("{1} and {2}")).toEqual([
    { kind: "gap", number: 1 },
    { kind: "text", text: " and " },
    { kind: "gap", number: 2 },
  ]);
});

test("text without markers is one token", () => {
  expect(parseGapContext("no gaps")).toEqual([{ kind: "text", text: "no gaps" }]);
});
