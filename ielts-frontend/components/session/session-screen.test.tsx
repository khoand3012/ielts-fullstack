import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import type { SessionDetail } from "@/lib/api/types";
import writing from "@/tests/fixtures/content/writing.json";
import { makeSession } from "@/tests/fixtures/session";
import { server } from "@/tests/msw/server";
import { renderWithProviders } from "@/tests/render";
import { resetRouter, router } from "@/tests/router";
import { SessionScreen } from "./session-screen";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);

const BASE = "*/api/backend/sessions/s-1";
const closed = () =>
  HttpResponse.json({ error: { code: "session_closed", message: "closed", extra: {} } }, { status: 409 });

/**
 * Fake backend for one session. `sessions` is what successive GETs return
 * (the last one repeats). Records every request in order.
 */
function backend(
  sessions: SessionDetail[],
  opts: { put?: () => Response; submit?: () => Response } = {},
) {
  const log: string[] = [];
  const puts: { question: number; value: unknown }[][] = [];
  let gets = 0;
  server.use(
    http.get(BASE, () => {
      const s = sessions[Math.min(gets, sessions.length - 1)];
      gets += 1;
      log.push("GET");
      return HttpResponse.json({ ...s, server_time: s.server_time });
    }),
    http.put(`${BASE}/answers`, async ({ request }) => {
      const body = (await request.json()) as { answers: { question: number; value: unknown }[] };
      log.push("PUT");
      puts.push(body.answers);
      if (opts.put) return opts.put();
      return HttpResponse.json({
        answers: Object.fromEntries(body.answers.map((a) => [String(a.question), a.value])),
      });
    }),
    http.post(`${BASE}/submit`, () => {
      log.push("SUBMIT");
      if (opts.submit) return opts.submit();
      return HttpResponse.json({ ...submitted(), content: undefined, answers: undefined });
    }),
  );
  return { log, puts };
}

const submitted = (overrides: Partial<SessionDetail> = {}) =>
  makeSession({
    status: "submitted",
    submitted_at: new Date().toISOString(),
    submit_reason: "student",
    grading_method: "auto",
    ...overrides,
  });

async function confirmSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Submit" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Submit answers" }));
  return dialog;
}

test("renders passages and resumes saved answers", async () => {
  backend([makeSession({ answers: { "1": ["TRUE"], "8": "moss" } })]);
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  expect(await screen.findByText("Stone upon Stone: The Craft of Dry-Stone Walling")).toBeInTheDocument();
  const q1 = screen.getByRole("radiogroup", { name: "Question 1" });
  expect(within(q1).getByRole("radio", { name: "TRUE" })).toBeChecked();
  expect(screen.getByRole("textbox", { name: "Question 8" })).toHaveValue("moss");
  expect(screen.getByRole("button", { name: "Go to question 1, answered" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go to question 8, answered" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go to question 2" })).toBeInTheDocument();
});

test("question nav switches to the passage that holds the question", async () => {
  backend([makeSession()]);
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  await screen.findByText("Stone upon Stone: The Craft of Dry-Stone Walling");
  await user.click(screen.getByRole("button", { name: "Go to question 14" }));
  expect(await screen.findByRole("combobox", { name: "Question 14" })).toBeInTheDocument();
});

test("submit flushes pending text first", async () => {
  const { log, puts } = backend([makeSession(), submitted()]);
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  await user.type(await screen.findByRole("textbox", { name: "Question 8" }), "moss");
  await confirmSubmit(user);
  expect(await screen.findByRole("heading", { name: "Submitted" })).toBeInTheDocument();
  const submitAt = log.indexOf("SUBMIT");
  expect(submitAt).toBeGreaterThan(0);
  const putsBeforeSubmit = log.slice(0, submitAt).filter((l) => l === "PUT").length;
  expect(putsBeforeSubmit).toBeGreaterThan(0);
  expect(puts.slice(0, putsBeforeSubmit).flat()).toContainEqual({ question: 8, value: "moss" });
});

test("offline submit is blocked with a message", async () => {
  const { log } = backend([makeSession()], { put: () => HttpResponse.error() });
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  await user.type(await screen.findByRole("textbox", { name: "Question 8" }), "moss");
  const dialog = await confirmSubmit(user);
  expect(await within(dialog).findByText(/aren't saved yet/)).toBeInTheDocument();
  expect(log).not.toContain("SUBMIT");
});

test("second submit 409 is treated as already submitted", async () => {
  const { log } = backend([makeSession(), submitted()], { submit: closed });
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  await screen.findByRole("button", { name: "Submit" });
  await confirmSubmit(user);
  expect(await screen.findByRole("heading", { name: "Submitted" })).toBeInTheDocument();
  expect(log).toContain("SUBMIT");
  expect(screen.queryByText(/Couldn't submit/)).not.toBeInTheDocument();
});

test("exam countdown uses server time and never disables inputs", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const serverNow = Date.now() + 5 * 60_000; // server clock 5 min ahead of the client
  const { puts } = backend([
    makeSession({
      mode: "exam",
      server_time: new Date(serverNow).toISOString(),
      deadline: new Date(serverNow + 2_000).toISOString(),
    }),
  ]);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  const timer = await screen.findByRole("timer");
  expect(timer.textContent).toMatch(/^00:0[12]$/);

  await act(async () => {
    vi.advanceTimersByTime(3_000);
  });
  expect(screen.getByRole("timer")).toHaveTextContent("00:00");
  expect(screen.getByText(/Time's up — submitting your answers/)).toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Question 8" });
  expect(input).toBeEnabled();
  await user.type(input, "late");
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  await waitFor(() => expect(puts.flat()).toContainEqual({ question: 8, value: "late" }));
});

test("late save shows time's up", async () => {
  backend(
    [makeSession({ mode: "exam", deadline: new Date(Date.now() + 60_000).toISOString() }), submitted({ submit_reason: "timeout" })],
    { put: closed },
  );
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  const q1 = await screen.findByRole("radiogroup", { name: "Question 1" });
  await user.click(within(q1).getByRole("radio", { name: "TRUE" }));
  expect(await screen.findByRole("heading", { name: "Time's up — submitted" })).toBeInTheDocument();
});

test("practice mode shows no timer", async () => {
  backend([makeSession()]);
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  await screen.findByRole("button", { name: "Submit" });
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(screen.getByText("Practice")).toBeInTheDocument();
});

test("unanswered count in submit dialog", async () => {
  backend([makeSession({ answers: { "1": ["TRUE"], "8": "moss" } })]);
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  await user.click(await screen.findByRole("button", { name: "Submit" }));
  expect(await screen.findByText("38 of 40 questions unanswered.")).toBeInTheDocument();
});

test("a submitted session opens straight to the submitted view", async () => {
  backend([submitted({ submit_reason: "timeout" })]);
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  expect(await screen.findByRole("heading", { name: "Time's up — submitted" })).toBeInTheDocument();
  expect(screen.getByText(/Results aren't available yet\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "My sessions" })).toHaveAttribute("href", "/sessions");
});

test("a writing session shows that the test type isn't available yet", async () => {
  backend([makeSession({ skill: "writing", content: structuredClone(writing) })]);
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  expect(await screen.findByText("This test type isn't available yet")).toBeInTheDocument();
});

test("an unknown session shows not found", async () => {
  server.use(
    http.get(BASE, () =>
      HttpResponse.json({ error: { code: "not_found", message: "x", extra: {} } }, { status: 404 }),
    ),
  );
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  expect(await screen.findByText("Session not found")).toBeInTheDocument();
});

test("a failed background refetch keeps the test on screen", async () => {
  backend([makeSession()], { put: closed });
  let gets = 0;
  server.use(
    http.get(BASE, () => {
      gets += 1;
      if (gets === 1) return HttpResponse.json(makeSession());
      return HttpResponse.json({ error: { code: "not_found", message: "x", extra: {} } }, { status: 404 });
    }),
  );
  const user = userEvent.setup();
  renderWithProviders(<SessionScreen sessionId="s-1" />);
  const q1 = await screen.findByRole("radiogroup", { name: "Question 1" });
  await user.click(within(q1).getByRole("radio", { name: "TRUE" }));
  expect(await screen.findByText(/Couldn't refresh this session/)).toBeInTheDocument();
  expect(gets).toBe(2);
  expect(screen.getByRole("radiogroup", { name: "Question 1" })).toBeInTheDocument();
  expect(screen.queryByText("Session not found")).not.toBeInTheDocument();
});
