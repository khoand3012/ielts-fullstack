import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import type { TestSummary } from "@/lib/api/types";
import { server } from "@/tests/msw/server";
import { renderWithProviders } from "@/tests/render";
import { resetRouter, router } from "@/tests/router";
import { StartTestDialog } from "./start-test-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);

const reading: TestSummary = {
  id: "t-1",
  skill: "reading",
  title: "Practice Test 1 — Academic Reading",
  exam_time_limit_minutes: 60,
};

function renderDialog() {
  renderWithProviders(<StartTestDialog test={reading} open onOpenChange={() => {}} />);
}

function onStart(respond: () => Response | Promise<Response>) {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/backend/sessions", async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

const created = () => HttpResponse.json({ id: "s-9" }, { status: 201 });

test("starts in practice mode by default", async () => {
  const bodies = onStart(created);
  renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Start test" }));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sessions/s-9"));
  expect(bodies).toEqual([{ test_id: "t-1", mode: "practice" }]);
});

test("starts in exam mode when chosen", async () => {
  const bodies = onStart(created);
  renderDialog();
  expect(screen.getByText(/60-minute countdown/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: /Exam/ }));
  await userEvent.click(screen.getByRole("button", { name: "Start test" }));
  await waitFor(() => expect(router.push).toHaveBeenCalled());
  expect(bodies).toEqual([{ test_id: "t-1", mode: "exam" }]);
});

test("shows the daily limit and when it resets", async () => {
  onStart(() =>
    HttpResponse.json(
      {
        error: {
          code: "quota_exceeded",
          message: "Daily limit reached",
          extra: { resets_at: "2026-10-25T00:00:00Z" },
        },
      },
      { status: 429 },
    ),
  );
  renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Start test" }));
  const resetAt = new Date("2026-10-25T00:00:00Z").toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  expect(
    await screen.findByText(`You've reached today's limit. It resets at ${resetAt}.`),
  ).toBeInTheDocument();
  expect(router.push).not.toHaveBeenCalled();
});

test("shows a message when the test cannot be started", async () => {
  onStart(() =>
    HttpResponse.json(
      { error: { code: "conflict", message: "Speaking is not available", extra: {} } },
      { status: 409 },
    ),
  );
  renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Start test" }));
  expect(await screen.findByText("This test can't be started yet.")).toBeInTheDocument();
});

test("shows a message when the test is gone", async () => {
  onStart(() =>
    HttpResponse.json({ error: { code: "not_found", message: "x", extra: {} } }, { status: 404 }),
  );
  renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Start test" }));
  expect(await screen.findByText("This test is no longer available.")).toBeInTheDocument();
});

test("shows a retry message on a server error", async () => {
  onStart(() => new HttpResponse(null, { status: 500 }));
  renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Start test" }));
  expect(await screen.findByText("Couldn't start the test. Try again.")).toBeInTheDocument();
});

test("the button is disabled while starting, so a test can't be started twice", async () => {
  const bodies = onStart(async () => {
    await delay(50);
    return created();
  });
  renderDialog();
  const button = screen.getByRole("button", { name: "Start test" });
  await userEvent.click(button);
  expect(screen.getByRole("button", { name: /Starting/ })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /Starting/ }));
  await waitFor(() => expect(router.push).toHaveBeenCalled());
  expect(bodies).toHaveLength(1);
});
