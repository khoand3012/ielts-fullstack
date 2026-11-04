import type { ResultQuestion, SessionResult } from "@/lib/api/types";

/** A graded Reading result with two questions, as GET /sessions/{id}/result returns it. */
export function makeResult(overrides: Partial<SessionResult> = {}): SessionResult {
  const questions: ResultQuestion[] = [
    {
      number: 1,
      numbers: [1],
      kind: "single_choice",
      answer: "TRUE",
      accepted: ["TRUE"],
      correct_choices: null,
      marks: 1,
      max_marks: 1,
    },
    {
      number: 8,
      numbers: [8],
      kind: "text",
      answer: "moss",
      accepted: ["lichen", "lichens"],
      correct_choices: null,
      marks: 0,
      max_marks: 1,
    },
  ];
  return {
    session_id: "s-1",
    test_id: "t-1",
    title: "Practice Test 1 — Academic Reading",
    skill: "reading",
    module: "academic",
    mode: "practice",
    submit_reason: "student",
    grading_method: "auto",
    started_at: "2026-10-24T10:00:00Z",
    submitted_at: "2026-10-24T10:30:00Z",
    time_spent_seconds: 1800,
    status: "graded",
    raw_score: 1,
    max_score: 2,
    band: 5.5,
    answered: 2,
    questions,
    writing: null,
    ...overrides,
  };
}
