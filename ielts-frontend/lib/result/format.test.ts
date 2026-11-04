import { expect, test } from "vitest";
import {
  answerList,
  CRITERION_SHORT,
  CRITERION_TONE,
  formatBand,
  formatDuration,
  questionLabel,
  TONE_CLASSES,
  verdict,
} from "./format";

test("questionLabel handles single, consecutive and non-consecutive numbers", () => {
  expect(questionLabel([5], 5)).toBe("Q5");
  expect(questionLabel([6, 5], 5)).toBe("Q5–6");
  expect(questionLabel([5, 7], 5)).toBe("Q5, 7");
  expect(questionLabel([], 9)).toBe("Q9");
});

test("formatDuration covers seconds, minutes and hours", () => {
  expect(formatDuration(45)).toBe("45 s");
  expect(formatDuration(125)).toBe("2 min 5 s");
  expect(formatDuration(3600)).toBe("1 h 0 min");
  expect(formatDuration(3 * 3600 + 25 * 60 + 59)).toBe("3 h 25 min");
  expect(formatDuration(-5)).toBe("0 s");
});

test("formatBand, verdict and answerList", () => {
  expect(formatBand(null)).toBe("—");
  expect(formatBand(7)).toBe("7.0");
  expect(verdict({ marks: 1, max_marks: 1 })).toBe("correct");
  expect(verdict({ marks: 1, max_marks: 2 })).toBe("partial");
  expect(verdict({ marks: 0, max_marks: 1 })).toBe("incorrect");
  expect(answerList(null)).toEqual([]);
  expect(answerList(["A", " "])).toEqual(["A"]);
  expect(answerList("x")).toEqual(["x"]);
});

test("criterion tones group TA and TR; tone classes are literal per tone", () => {
  expect(CRITERION_TONE.task_achievement).toBe("task");
  expect(CRITERION_TONE.task_response).toBe("task");
  expect(CRITERION_TONE.grammatical_range_accuracy).toBe("gra");
  expect(Object.values(CRITERION_SHORT)).toEqual(["TA", "TR", "CC", "LR", "GRA"]);
  expect(TONE_CLASSES.gra.dot).toBe("bg-crit-gra");
  expect(TONE_CLASSES.lr.mark).toContain("underline");
});
