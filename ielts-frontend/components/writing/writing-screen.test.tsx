import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SessionDetail } from "@/lib/api/types";
import type { WritingContent } from "@/lib/content/schema";
import writing from "@/tests/fixtures/content/writing.json";
import { makeSession } from "@/tests/fixtures/session";
import { server } from "@/tests/msw/server";
import { renderWithProviders } from "@/tests/render";
import { resetRouter, router } from "@/tests/router";
import { WritingScreen } from "./writing-screen";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);
afterEach(() => vi.useRealTimers());

const BASE = "*/api/backend/sessions/s-1";
const content = writing as WritingContent;

function backend() {
  const log: string[] = [];
  const puts: { question: number; value: unknown }[][] = [];
  const putTimes: number[] = [];
  server.use(
    http.put(`${BASE}/answers`, async ({ request }) => {
      const body = (await request.json()) as { answers: { question: number; value: unknown }[] };
      log.push("PUT");
      putTimes.push(Date.now());
      puts.push(body.answers);
      return HttpResponse.json({
        answers: Object.fromEntries(body.answers.map((a) => [String(a.question), a.value])),
      });
    }),
    http.post(`${BASE}/submit`, () => {
      log.push("SUBMIT");
      return HttpResponse.json(makeSession({ status: "submitted" }));
    }),
  );
  return { log, puts, putTimes };
}

function session(overrides: Partial<SessionDetail> = {}) {
  return makeSession({ skill: "writing", title: "Practice Test 1 — Academic Writing", content, ...overrides });
}

function Harness({ session: s }: { session: SessionDetail }) {
  const [expired, setExpired] = useState(false);
  return (
    <WritingScreen
      session={s}
      content={content}
      offsetMs={0}
      expired={expired}
      onExpire={() => setExpired(true)}
      onClosed={() => {}}
    />
  );
}

function renderScreen(s: SessionDetail) {
  return renderWithProviders(<Harness session={s} />);
}

test("renders both tasks stacked, Task 1 first, each with a textbox", () => {
  renderScreen(session());
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["Task 1", "Task 2"]);
  const boxes = screen.getAllByRole("textbox");
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toHaveAccessibleName("Your answer for Task 1");
  expect(boxes[1]).toHaveAccessibleName("Your answer for Task 2");
});

test("saved answers appear in the right boxes", () => {
  renderScreen(session({ answers: { "1": "my essay one", "2": "" } }));
  expect(screen.getByRole("textbox", { name: "Your answer for Task 1" })).toHaveValue("my essay one");
  expect(screen.getByRole("textbox", { name: "Your answer for Task 2" })).toHaveValue("");
});

test("typing in Task 2 saves it keyed by the task number", async () => {
  const { puts } = backend();
  const user = userEvent.setup();
  renderScreen(session());
  await user.type(screen.getByRole("textbox", { name: "Your answer for Task 2" }), "hello");
  await waitFor(() => expect(puts.flat()).toContainEqual({ question: 2, value: "hello" }));
});

test("practice shows no countdown; exam with a deadline shows one", () => {
  const { unmount } = renderScreen(session());
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  unmount();
  renderScreen(session({ mode: "exam", deadline: new Date(Date.now() + 60_000).toISOString() }));
  expect(screen.getByRole("timer")).toBeInTheDocument();
});

test("submit dialog names an empty Task 2, and confirming submits", async () => {
  const { log } = backend();
  const user = userEvent.setup();
  renderScreen(session({ answers: { "1": "essay one", "2": "" } }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Task 2 is empty")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Submit answers" }));
  await waitFor(() => expect(log).toContain("SUBMIT"));
});

test("no notice when both tasks are filled", async () => {
  const user = userEvent.setup();
  renderScreen(session({ answers: { "1": "one", "2": "two" } }));
  await user.click(screen.getByRole("button", { name: "Submit" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByText(/empty|are empty|is empty/i)).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Submit answers" })).toBeEnabled();
});

test("both tasks empty can still be submitted and the notice names both", async () => {
  const { log } = backend();
  const user = userEvent.setup();
  renderScreen(session());
  await user.click(screen.getByRole("button", { name: "Submit" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Task 1 and Task 2 are empty")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Submit answers" }));
  await waitFor(() => expect(log).toContain("SUBMIT"));
});

test("on expiry the banner shows and pending text is flushed before the debounce would fire", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts, putTimes } = backend();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  // Countdown ticks at 1 s and 2 s after mount; it sees 0 remaining on the 2 s tick.
  renderScreen(session({ mode: "exam", deadline: new Date(Date.now() + 1_900).toISOString() }));
  await act(async () => {
    vi.advanceTimersByTime(1_850);
  });
  // Last keystroke at ~1.85 s: the 500 ms debounce would not fire until ~2.35 s.
  await user.type(screen.getByRole("textbox", { name: "Your answer for Task 1" }), "late");
  const typedAt = Date.now();
  expect(puts).toHaveLength(0);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(150); // the 2 s tick: expiry, well inside the debounce window
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Time's up");
  await waitFor(() => expect(puts.flat()).toContainEqual({ question: 1, value: "late" }));
  // Sent by the expiry flush, not by the 500 ms debounce timer (fake clock).
  expect(putTimes[0] - typedAt).toBeLessThan(400);
});

test("on session_closed only text typed after the last successful save is reported lost", async () => {
  let puts = 0;
  server.use(
    http.put(`${BASE}/answers`, async ({ request }) => {
      puts += 1;
      const body = (await request.json()) as { answers: { question: number; value: unknown }[] };
      if (puts > 1) {
        return HttpResponse.json(
          { error: { code: "session_closed", message: "closed", extra: {} } },
          { status: 409 },
        );
      }
      return HttpResponse.json({
        answers: Object.fromEntries(body.answers.map((a) => [String(a.question), a.value])),
      });
    }),
  );
  const onLostText = vi.fn();
  const onClosed = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <WritingScreen
      session={session()}
      content={content}
      offsetMs={0}
      expired={false}
      onExpire={() => {}}
      onClosed={onClosed}
      onLostText={onLostText}
    />,
  );
  await user.type(screen.getByRole("textbox", { name: "Your answer for Task 1" }), "saved essay");
  await waitFor(() => expect(puts).toBe(1));
  await user.type(screen.getByRole("textbox", { name: "Your answer for Task 2" }), "late words");
  await waitFor(() => expect(onClosed).toHaveBeenCalled());
  expect(onLostText).toHaveBeenCalledTimes(1);
  expect(onLostText).toHaveBeenCalledWith({ 2: "late words" });
});
