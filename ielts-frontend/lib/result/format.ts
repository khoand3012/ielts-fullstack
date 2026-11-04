import type { Criterion, ResultQuestion } from "@/lib/api/types";

export const formatBand = (band: number | null): string => (band === null ? "—" : band.toFixed(1));

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

export const CRITERION_LABELS: Record<Criterion, string> = {
  task_achievement: "Task Achievement",
  task_response: "Task Response",
  coherence_cohesion: "Coherence and Cohesion",
  lexical_resource: "Lexical Resource",
  grammatical_range_accuracy: "Grammatical Range and Accuracy",
};

/** "Q5", "Q5–6" for consecutive numbers, "Q5, 7" otherwise. */
export function questionLabel(numbers: number[], fallback: number): string {
  const list = numbers.length > 0 ? [...numbers].sort((a, b) => a - b) : [fallback];
  if (list.length === 1) return `Q${list[0]}`;
  const consecutive = list.every((n, i) => i === 0 || n === list[i - 1] + 1);
  return consecutive ? `Q${list[0]}–${list[list.length - 1]}` : `Q${list.join(", ")}`;
}

export type Verdict = "correct" | "partial" | "incorrect";

export function verdict(q: Pick<ResultQuestion, "marks" | "max_marks">): Verdict {
  if (q.marks >= q.max_marks && q.max_marks > 0) return "correct";
  return q.marks > 0 ? "partial" : "incorrect";
}

/** The saved answer as a list of picks; empty when nothing was answered. */
export function answerList(answer: ResultQuestion["answer"]): string[] {
  if (answer === null) return [];
  const list = Array.isArray(answer) ? answer : [answer];
  return list.filter((a) => a.trim() !== "");
}

export type CriterionTone = "task" | "cc" | "lr" | "gra";

export const CRITERION_TONE: Record<Criterion, CriterionTone> = {
  task_achievement: "task",
  task_response: "task",
  coherence_cohesion: "cc",
  lexical_resource: "lr",
  grammatical_range_accuracy: "gra",
};

export const CRITERION_SHORT: Record<Criterion, string> = {
  task_achievement: "TA",
  task_response: "TR",
  coherence_cohesion: "CC",
  lexical_resource: "LR",
  grammatical_range_accuracy: "GRA",
};

/**
 * Literal class strings per tone (Tailwind only sees full names). `mark` is a tinted, underlined
 * highlight — the underline keeps colour from being the only signal; text on it stays foreground.
 */
export const TONE_CLASSES: Record<CriterionTone, { mark: string; dot: string; bar: string }> = {
  task: {
    mark: "bg-crit-task/15 text-foreground underline decoration-crit-task decoration-2 underline-offset-4",
    dot: "bg-crit-task",
    bar: "bg-crit-task",
  },
  cc: {
    mark: "bg-crit-cc/15 text-foreground underline decoration-crit-cc decoration-2 underline-offset-4",
    dot: "bg-crit-cc",
    bar: "bg-crit-cc",
  },
  lr: {
    mark: "bg-crit-lr/15 text-foreground underline decoration-crit-lr decoration-2 underline-offset-4",
    dot: "bg-crit-lr",
    bar: "bg-crit-lr",
  },
  gra: {
    mark: "bg-crit-gra/15 text-foreground underline decoration-crit-gra decoration-2 underline-offset-4",
    dot: "bg-crit-gra",
    bar: "bg-crit-gra",
  },
};
