import type { ResultQuestion, ResultSection } from "@/lib/api/types";
import { answerList, verdict } from "@/lib/result/format";

export type ChipState = "correct" | "partial" | "wrong" | "blank";

export function chipState(q: ResultQuestion): ChipState {
  if (answerList(q.answer).length === 0) return "blank";
  const v = verdict(q);
  return v === "incorrect" ? "wrong" : v;
}

const TYPE_LABELS: Record<string, string> = {
  true_false_not_given: "True / False / Not given",
  yes_no_not_given: "Yes / No / Not given",
  headings: "Matching headings",
  sentence_endings: "Sentence endings",
  multiple_choice: "Multiple choice",
  fill_blank: "Gap fill",
  matching: "Matching",
  short_answer: "Short answer",
};

export function questionTypeLabel(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  const text = type.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type TypeAccuracy = {
  type: string;
  label: string;
  marks: number;
  max: number;
  missed: number;
};

export function typeAccuracy(qs: ResultQuestion[]): TypeAccuracy[] {
  const byType = new Map<string, TypeAccuracy>();
  for (const q of qs) {
    const row = byType.get(q.question_type) ?? {
      type: q.question_type,
      label: questionTypeLabel(q.question_type),
      marks: 0,
      max: 0,
      missed: 0,
    };
    row.marks += q.marks;
    row.max += q.max_marks;
    if (chipState(q) !== "correct") row.missed += 1;
    byType.set(q.question_type, row);
  }
  const ratio = (r: TypeAccuracy) => (r.max > 0 ? r.marks / r.max : 0);
  return [...byType.values()].sort(
    (a, b) => ratio(a) - ratio(b) || a.label.localeCompare(b.label),
  );
}

export type SectionMarks = {
  number: number;
  title: string;
  marks: number;
  max: number;
};

export function sectionMarks(
  qs: ResultQuestion[],
  sections: ResultSection[] | null,
): SectionMarks[] {
  const titles = new Map((sections ?? []).map((s) => [s.number, s.title]));
  const bySection = new Map<number, SectionMarks>();
  for (const q of qs) {
    const row = bySection.get(q.section) ?? {
      number: q.section,
      title: titles.get(q.section) ?? "",
      marks: 0,
      max: 0,
    };
    row.marks += q.marks;
    row.max += q.max_marks;
    bySection.set(q.section, row);
  }
  return [...bySection.values()].sort((a, b) => a.number - b.number);
}

export function fixNextForQuestions(qs: ResultQuestion[]): string[] {
  return typeAccuracy(qs)
    .filter((r) => r.missed > 0)
    .slice(0, 3)
    .map((r) => `${r.label}: ${r.marks} of ${r.max} right`);
}
