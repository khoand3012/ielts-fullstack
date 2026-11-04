import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { toast } from "sonner";
import { makeSession } from "@/tests/fixtures/session";
import { server } from "@/tests/msw/server";
import { resetRouter, router } from "@/tests/router";
import { useSessionAnswers } from "./use-session-answers";

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(resetRouter);

type Put = { answers: { question: number; value: unknown }[] };

function onPut(respond: (body: Put) => Response | Promise<Response>) {
  const bodies: Put[] = [];
  server.use(
    http.put("*/api/backend/sessions/s-1/answers", async ({ request }) => {
      const body = (await request.json()) as Put;
      bodies.push(body);
      return respond(body);
    }),
  );
  return bodies;
}

const echo = (body: Put) =>
  HttpResponse.json({
    answers: Object.fromEntries(body.answers.map((a) => [String(a.question), a.value])),
  });

test("initial answers come from session.answers with numeric keys", () => {
  const session = makeSession({ answers: { "1": ["TRUE"], "8": "moss" } });
  const { result } = renderHook(() => useSessionAnswers(session, { onClosed: () => {} }));
  expect(result.current.answers).toEqual({ 1: ["TRUE"], 8: "moss" });
  expect(result.current.status).toBe("saved");
});

test("server echo does not clobber a field edited during the request", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let n = 0;
  const bodies = onPut(async (body) => {
    n += 1;
    if (n === 1) await held;
    return echo(body);
  });
  const { result } = renderHook(() => useSessionAnswers(makeSession(), { onClosed: () => {} }));

  let flushed!: Promise<boolean>;
  act(() => {
    result.current.setAnswer(8, "mo", { debounce: true });
    flushed = result.current.flush();
  });
  await waitFor(() => expect(bodies).toHaveLength(1));
  act(() => result.current.setAnswer(8, "moss", { debounce: true }));

  release();
  await act(async () => {
    await flushed;
  });
  expect(result.current.answers[8]).toBe("moss");
  // The newer value is then saved by its own request.
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].answers).toEqual([{ question: 8, value: "moss" }]);
  expect(result.current.answers[8]).toBe("moss");
});

test("409 calls onClosed", async () => {
  onPut(() =>
    HttpResponse.json(
      { error: { code: "session_closed", message: "closed", extra: {} } },
      { status: 409 },
    ),
  );
  const onClosed = vi.fn();
  const { result } = renderHook(() => useSessionAnswers(makeSession(), { onClosed }));
  act(() => result.current.setAnswer(1, ["TRUE"], { debounce: false }));
  await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  expect(result.current.status).toBe("closed");
});

test("works under StrictMode", async () => {
  const bodies = onPut(echo);
  const { result } = renderHook(() => useSessionAnswers(makeSession(), { onClosed: () => {} }), {
    wrapper: StrictMode,
  });
  act(() => result.current.setAnswer(1, ["TRUE"], { debounce: false }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].answers).toEqual([{ question: 1, value: ["TRUE"] }]);
});

test("a 401 sends the user to sign in", async () => {
  onPut(() =>
    HttpResponse.json({ error: { code: "unauthorized", message: "x", extra: {} } }, { status: 401 }),
  );
  const { result } = renderHook(() => useSessionAnswers(makeSession(), { onClosed: () => {} }));
  act(() => result.current.setAnswer(1, ["TRUE"], { debounce: false }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=%2F"));
});

test("leaving the page sends answers still waiting for their debounce", async () => {
  const bodies = onPut(echo);
  const { result, unmount } = renderHook(() =>
    useSessionAnswers(makeSession(), { onClosed: () => {} }),
  );
  act(() => result.current.setAnswer(8, "moss", { debounce: true }));
  unmount();
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].answers).toEqual([{ question: 8, value: "moss" }]);
});

test("coming back online saves straight away instead of waiting for the next retry", async () => {
  let offline = true;
  const bodies = onPut((body) => (offline ? HttpResponse.error() : echo(body)));
  const { result } = renderHook(() => useSessionAnswers(makeSession(), { onClosed: () => {} }));
  act(() => result.current.setAnswer(1, ["TRUE"], { debounce: false }));
  await waitFor(() => expect(result.current.status).toBe("retrying"));

  offline = false;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  // The first backoff retry is 1 s away; this must happen well before it.
  await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 300 });
  await waitFor(() => expect(result.current.status).toBe("saved"), { timeout: 300 });
});

test("a 422 that names no question warns and keeps saving", async () => {
  let n = 0;
  const bodies = onPut((body) => {
    n += 1;
    if (n === 1) {
      return HttpResponse.json(
        { error: { code: "validation_error", message: "Invalid answer", extra: {} } },
        { status: 422 },
      );
    }
    return echo(body);
  });
  const { result } = renderHook(() => useSessionAnswers(makeSession(), { onClosed: () => {} }));
  act(() => result.current.setAnswer(1, ["TRUE"], { debounce: false }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Some answers weren't saved: Invalid answer"),
  );
  act(() => result.current.setAnswer(2, ["FALSE"], { debounce: false }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(result.current.status).not.toBe("failed");
});
