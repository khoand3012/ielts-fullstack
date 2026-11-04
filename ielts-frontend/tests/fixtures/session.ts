import type { SessionDetail } from "@/lib/api/types";
import reading from "./content/reading.json";
import writing from "./content/writing.json";

/** A Reading session in practice mode with nothing answered, as GET /sessions/{id} returns it. */
export function makeSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  const now = new Date().toISOString();
  return {
    id: "s-1",
    test_id: "t-1",
    test_version_id: "v-1",
    title: "Practice Test 1 — Academic Reading",
    module: "academic",
    raw_score: null,
    band: null,
    skill: "reading",
    mode: "practice",
    status: "in_progress",
    started_at: now,
    deadline: null,
    submitted_at: null,
    submit_reason: null,
    request_manual_grading: false,
    grading_method: null,
    server_time: now,
    content: structuredClone(reading),
    answers: {},
    ...overrides,
  };
}

/** A Writing session whose content has tasks with min_words 150 and 250. */
export function makeWritingSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return makeSession({
    title: "Practice Test 1 — Academic Writing",
    skill: "writing",
    status: "submitted",
    content: structuredClone(writing),
    ...overrides,
  });
}
