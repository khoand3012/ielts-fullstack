import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SessionResult } from "@/lib/api/types";
import { POLL_CAP_MS, pollDelay } from "@/lib/result/queries";
import { makeResult, makeWritingResult } from "@/tests/fixtures/result";
import { server } from "@/tests/msw/server";
import { renderWithProviders } from "@/tests/render";
import { resetRouter, router } from "@/tests/router";
import { ResultScreen } from "./result-screen";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);
afterEach(() => vi.useRealTimers());

const URL = "*/api/backend/sessions/s-1/result";
const serve = (...results: SessionResult[]) => {
  let n = 0;
  server.use(
    http.get(URL, () => HttpResponse.json(results[Math.min(n++, results.length - 1)])),
  );
};
const apiError = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, extra: {} } }, { status });

test("graded Reading shows the score header and every question", async () => {
  serve(
    makeResult({
      questions: [
        ...makeResult().questions!,
        {
          number: 20,
          numbers: [20, 21],
          kind: "choice",
          answer: ["A", "C"],
          accepted: ["A", "B"],
          correct_choices: ["A"],
          marks: 1,
          max_marks: 2,
          section: 2,
          question_type: "multiple_choice",
        },
      ],
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("heading", { name: "Practice Test 1 — Academic Reading" })).toBeInTheDocument();
  expect(screen.getByText("5.5")).toBeInTheDocument();
  expect(screen.getByText("1/2", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText("30 min 0 s")).toBeInTheDocument();

  const rows = screen.getAllByRole("row");
  const q1 = within(rows.find((r) => within(r).queryByText("Q1"))!);
  expect(q1.getByText("Correct")).toBeInTheDocument();
  const q8 = within(rows.find((r) => within(r).queryByText("Q8"))!);
  expect(q8.getByText("moss")).toBeInTheDocument();
  expect(q8.getByText("Incorrect")).toBeInTheDocument();
  expect(q8.getByText("lichen / lichens")).toBeInTheDocument();
  const q20 = within(rows.find((r) => within(r).queryByText("Q20–21"))!);
  expect(q20.getByText("Partly correct")).toBeInTheDocument();
  expect(q20.getByText("(right)")).toBeInTheDocument();
  expect(q20.getByText("(wrong)")).toBeInTheDocument();
  expect(q20.getByText("A, B")).toBeInTheDocument();
});

test("null questions and null band still show the score with a note", async () => {
  serve(makeResult({ questions: null, max_score: null, band: null, answered: null, raw_score: 12 }));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText(/question-by-question review isn't available/)).toBeInTheDocument();
  expect(screen.getByText("Raw score")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText(/No band is given/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("polls while being graded, then shows the result and stops", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return HttpResponse.json(
        calls < 2
          ? makeResult({ status: "being_graded", raw_score: null, band: null, max_score: null, questions: null, answered: null })
          : makeResult(),
      );
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your result is being graded.");

  await vi.advanceTimersByTimeAsync(pollDelay(0) + 100);
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.queryByText("Your result is being graded")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your result is ready.");

  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(2);
});

test("a 409 sends the student back to the test", async () => {
  server.use(http.get(URL, () => apiError(409, "conflict")));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("This test is still in progress")).toBeInTheDocument();
  expect(router.replace).toHaveBeenCalledWith("/sessions/s-1");
});

test("a 404 shows not found without retrying", async () => {
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return apiError(404, "not_found");
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Result not found")).toBeInTheDocument();
  expect(calls).toBe(1);
});

test("graded Writing shows bands, comments, a blank task and the focus list", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("heading", { name: "Task 1" })).toBeInTheDocument();
  expect(screen.getByText("6.5", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText(/172 words/)).toBeInTheDocument();
  expect(screen.getByText("Task Achievement")).toBeInTheDocument();
  expect(screen.getByText("the graph go up").tagName).toBe("BLOCKQUOTE");
  expect(screen.getByText("the graph rises")).toBeInTheDocument();
  expect(screen.getByText("No comments for this criterion.")).toBeInTheDocument();
  expect(screen.getByText("Vary your sentence openings")).toBeInTheDocument();
  expect(screen.getByText(/0 words/)).toHaveTextContent("Not scored");
  expect(screen.getByText(/left blank/)).toBeInTheDocument();
});

test("script-like text in answers and comments renders as text", async () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const base = makeResult();
  serve(
    makeResult({ questions: [{ ...base.questions![1], answer: evil }] }),
    makeResult(),
  );
  const { unmount } = renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText(evil)).toBeInTheDocument();
  expect(document.querySelector("img, script")).toBeNull();
  unmount();

  serve(
    makeResult({
      skill: "writing",
      questions: null,
      writing: {
        focus: [evil],
        tasks: [
          {
            number: 1,
            band: 5,
            word_count: 3,
            text: "x",
            criteria: [
              {
                criterion: "task_response",
                band: 5,
                comments: [{ comment: evil, quote: evil, suggestion: evil }],
              },
            ],
          },
        ],
      },
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findAllByText(evil)).toHaveLength(4);
  expect(document.querySelector("img, script")).toBeNull();
});

const pending = (overrides: Partial<SessionResult> = {}) =>
  makeResult({
    status: "being_graded",
    raw_score: null,
    band: null,
    max_score: null,
    questions: null,
    answered: null,
    ...overrides,
  });

test("a being-graded Writing result (writing null) keeps polling", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return HttpResponse.json(pending({ skill: "writing", module: null, grading_method: "ai" }));
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(pollDelay(0) + pollDelay(1) + pollDelay(2) + 500);
  await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
});

test("a 5xx while polling keeps the old data and shows the retry alert", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return calls === 1 ? HttpResponse.json(pending()) : apiError(500, "internal");
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(pollDelay(0) + 20_000); // the poll plus 3 backed-off retries
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't refresh this result");
  expect(screen.getByText("Your result is being graded")).toBeInTheDocument();
});

test("polling stops after the cap; Check again resumes it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return HttpResponse.json(pending());
    }),
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  await screen.findByText("Your result is being graded");

  await vi.advanceTimersByTimeAsync(POLL_CAP_MS + 60_000);
  expect(await screen.findByText(/taking longer than expected/)).toBeInTheDocument();
  for (const link of screen.getAllByRole("link", { name: "My sessions" })) {
    expect(link).toHaveAttribute("href", "/sessions");
  }

  const stopped = calls;
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(calls).toBe(stopped);

  await user.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(calls).toBe(stopped + 1));
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBeGreaterThan(stopped + 1);
});
