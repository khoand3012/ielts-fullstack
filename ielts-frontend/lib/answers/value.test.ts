import { expect, test } from "vitest";
import { isAnswered, normalizeSaved, toggleChoice } from "./value";

test("single choice replaces the previous pick", () => {
  expect(toggleChoice([], "B", 1)).toEqual(["B"]);
  expect(toggleChoice(["B"], "C", 1)).toEqual(["C"]);
});

test("clicking a picked option unpicks it", () => {
  expect(toggleChoice(["B"], "B", 2)).toEqual([]);
  expect(toggleChoice(["B"], "B", 1)).toEqual([]);
});

test("multi choice adds up to the cap, then ignores new picks", () => {
  expect(toggleChoice(["B"], "D", 2)).toEqual(["B", "D"]);
  expect(toggleChoice(["B", "D"], "E", 2)).toEqual(["B", "D"]);
});

test("isAnswered treats empty values as unanswered", () => {
  for (const v of [null, [], "", "   ", undefined]) expect(isAnswered(v)).toBe(false);
  expect(isAnswered("moss")).toBe(true);
  expect(isAnswered(["A"])).toBe(true);
});

test("normalizeSaved converts string keys to numbers and drops unknown shapes", () => {
  expect(normalizeSaved({ "21": ["B", "D"], "8": "moss", "3": null, x: "y", "4": 5 })).toEqual({
    21: ["B", "D"],
    8: "moss",
    3: null,
  });
});
