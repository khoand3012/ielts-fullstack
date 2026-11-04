import { expect, test } from "vitest";
import type { ResultQuestion } from "@/lib/api/types";
import {
  chipState,
  fixNextForQuestions,
  questionTypeLabel,
  sectionMarks,
  typeAccuracy,
} from "./question-stats";

function q(over: Partial<ResultQuestion> = {}): ResultQuestion {
  return {
    number: 1,
    numbers: [1],
    kind: "text",
    answer: "x",
    accepted: [],
    correct_choices: null,
    marks: 1,
    max_marks: 1,
    section: 1,
    question_type: "fill_blank",
    ...over,
  };
}

test("chipState maps verdicts and blanks", () => {
  expect(chipState(q())).toBe("correct");
  expect(
    chipState(
      q({ kind: "choice", answer: ["A", "B"], marks: 1, max_marks: 2 }),
    ),
  ).toBe("partial");
  expect(chipState(q({ marks: 0 }))).toBe("wrong");
  expect(chipState(q({ answer: null, marks: 0 }))).toBe("blank");
  expect(chipState(q({ answer: "", marks: 0 }))).toBe("blank");
  expect(chipState(q({ answer: [], marks: 0 }))).toBe("blank");
});

test("questionTypeLabel uses known labels and a readable fallback", () => {
  expect(questionTypeLabel("true_false_not_given")).toBe(
    "True / False / Not given",
  );
  expect(questionTypeLabel("diagram_label")).toBe("Diagram label");
});

test("typeAccuracy sorts weakest first and counts partials as missed", () => {
  const rows = typeAccuracy([
    q({ question_type: "matching", marks: 1 }),
    q({ question_type: "matching", marks: 1 }),
    q({ question_type: "matching", marks: 1 }),
    q({ question_type: "matching", marks: 1 }),
    q({ question_type: "multiple_choice", marks: 1 }),
    q({ question_type: "multiple_choice", marks: 0 }),
    q({ question_type: "multiple_choice", marks: 0 }),
  ]);
  expect(rows.map((r) => r.type)).toEqual(["multiple_choice", "matching"]);
  expect(rows[0]).toMatchObject({
    label: "Multiple choice",
    marks: 1,
    max: 3,
    missed: 2,
  });
  const partial = typeAccuracy([
    q({ marks: 1, max_marks: 2, kind: "choice", answer: ["A"] }),
  ]);
  expect(partial[0].missed).toBe(1);
});

test("sectionMarks orders by number and tolerates missing titles", () => {
  const qs = [
    q({ section: 2, marks: 1 }),
    q({ section: 1, marks: 1 }),
    q({ section: 1, marks: 1 }),
    q({ section: 1, marks: 0 }),
  ];
  expect(sectionMarks(qs, [{ number: 1, title: "P1" }])).toEqual([
    { number: 1, title: "P1", marks: 2, max: 3 },
    { number: 2, title: "", marks: 1, max: 1 },
  ]);
  expect(sectionMarks(qs, null)[0].title).toBe("");
});

test("fixNextForQuestions skips clean types and caps at three", () => {
  const types = ["a", "b", "c", "d"];
  const qs = [
    ...types.map((t) => q({ question_type: t, marks: 0 })),
    q({ question_type: "clean", marks: 1 }),
  ];
  const out = fixNextForQuestions(qs);
  expect(out).toHaveLength(3);
  expect(out.join()).not.toContain("Clean");
  expect(out[0]).toBe("A: 0 of 1 right");
  expect(fixNextForQuestions([])).toEqual([]);
  expect(typeAccuracy([])).toEqual([]);
});
