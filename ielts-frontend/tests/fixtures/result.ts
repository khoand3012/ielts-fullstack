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
      section: 1,
      question_type: "true_false_not_given",
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
      section: 1,
      question_type: "fill_blank",
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
    sections: [{ number: 1, title: "The history of glass" }],
    writing: null,
    ...overrides,
  };
}

/** A graded Writing result: task 1 scored with comments and essay text, task 2 left blank. */
export function makeWritingResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return makeResult({
    skill: "writing",
    module: null,
    raw_score: null,
    max_score: null,
    answered: null,
    questions: null,
    sections: null,
    band: 6.5,
    grading_method: "ai",
    writing: {
      focus: ["Vary your sentence openings", "Check article use"],
      tasks: [
        {
          number: 1,
          band: 6,
          word_count: 172,
          text: "Overall, the graph go up between 2000 and 2020.\n\nThe graph go up again in 2010.",
          criteria: [
            {
              criterion: "task_achievement",
              band: 6,
              comments: [
                { comment: "Covers the key trends.", quote: "the graph go up", suggestion: "the graph rises" },
                { comment: "No overview given.", quote: null, suggestion: null },
              ],
            },
            { criterion: "lexical_resource", band: 6.5, comments: [] },
            {
              criterion: "grammatical_range_accuracy",
              band: 6,
              comments: [
                {
                  comment: "Use the past tense for past years.",
                  quote: "The graph go up",
                  suggestion: "The graph went up",
                },
              ],
            },
          ],
        },
        { number: 2, band: null, word_count: 0, text: "", criteria: [] },
      ],
    },
    ...overrides,
  });
}
