import type { SessionDetail } from "@/lib/api/types";
import reading from "./content/reading.json";

/** A Reading session in practice mode with nothing answered, as GET /sessions/{id} returns it. */
export function makeSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  const now = new Date().toISOString();
  return {
    id: "s-1",
    test_id: "t-1",
    test_version_id: "v-1",
    title: "Practice Test 1 — Academic Reading",
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
