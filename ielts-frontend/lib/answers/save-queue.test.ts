import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { SaveQueue, type SaveStatus } from "./save-queue";
import type { AnswerValue } from "./value";

type Batch = { question: number; value: AnswerValue }[];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Echoes each batch back as the saved answers unless a test overrides it. */
function setup(sendImpl?: (batch: Batch) => Promise<Record<string, unknown>>) {
  const calls: Batch[] = [];
  const statuses: SaveStatus[] = [];
  const handlers = {
    onSaved: vi.fn(),
    onStatus: vi.fn((s: SaveStatus) => statuses.push(s)),
    onClosed: vi.fn(),
    onRejected: vi.fn(),
    onFatal: vi.fn(),
    sendOnDispose: vi.fn(),
  };
  const send = vi.fn(async (batch: Batch) => {
    calls.push(batch);
    if (sendImpl) return sendImpl(batch);
    return Object.fromEntries(batch.map((a) => [String(a.question), a.value]));
  });
  const queue = new SaveQueue({ send, ...handlers });
  return { queue, send, calls, statuses, ...handlers };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("debounced text is sent once after 500 ms with the last value", async () => {
  const { queue, calls } = setup();
  queue.set(8, "m", { debounce: true });
  await vi.advanceTimersByTimeAsync(200);
  queue.set(8, "mo", { debounce: true });
  await vi.advanceTimersByTimeAsync(200);
  queue.set(8, "moss", { debounce: true });
  await vi.advanceTimersByTimeAsync(499);
  expect(calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual([[{ question: 8, value: "moss" }]]);
});

test("choice changes are sent immediately", async () => {
  const { queue, calls } = setup();
  queue.set(1, ["TRUE"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toEqual([[{ question: 1, value: ["TRUE"] }]]);
});

test("flush sends a pending debounced value immediately", async () => {
  const d = deferred<Record<string, unknown>>();
  const { queue, calls } = setup(() => d.promise);
  queue.set(8, "moss", { debounce: true });
  let result: boolean | undefined;
  const flushed = queue.flush().then((r) => (result = r));
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toEqual([[{ question: 8, value: "moss" }]]);
  expect(result).toBeUndefined(); // still waiting for the response
  d.resolve({ "8": "moss" });
  await flushed;
  expect(result).toBe(true);
  // The debounce was cancelled, so nothing is sent again later.
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toHaveLength(1);
});

test("flush with nothing pending resolves true", async () => {
  const { queue, send } = setup();
  await expect(queue.flush()).resolves.toBe(true);
  expect(send).not.toHaveBeenCalled();
});

test("flush while offline resolves false instead of hanging", async () => {
  let fail = true;
  const { queue, calls } = setup(async (batch) => {
    if (fail) throw new ApiError(0, "network", "offline");
    return Object.fromEntries(batch.map((a) => [String(a.question), a.value]));
  });
  queue.set(8, "moss", { debounce: true });
  await expect(queue.flush()).resolves.toBe(false);
  expect(calls).toHaveLength(1);
  expect(queue.hasPending(8)).toBe(true);
  // It keeps retrying in the background.
  fail = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toHaveLength(2);
  expect(queue.hasPending(8)).toBe(false);
});

test("one request in flight; edits during flight are coalesced into the next", async () => {
  const first = deferred<Record<string, unknown>>();
  let n = 0;
  const { queue, calls } = setup(async (batch) => {
    n += 1;
    if (n === 1) return first.promise;
    return Object.fromEntries(batch.map((a) => [String(a.question), a.value]));
  });
  queue.set(1, ["A"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  queue.set(2, ["B"], { debounce: false });
  queue.set(1, ["C"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(1);
  first.resolve({ "1": ["A"] });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(
    expect.arrayContaining([
      { question: 1, value: ["C"] },
      { question: 2, value: ["B"] },
    ]),
  );
  expect(calls[1]).toHaveLength(2);
});

test("hasPending is true for in-flight and queued questions and false after save", async () => {
  const d = deferred<Record<string, unknown>>();
  const { queue } = setup(() => d.promise);
  queue.set(1, ["A"], { debounce: false });
  queue.set(8, "mo", { debounce: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.hasPending(1)).toBe(true); // in flight
  expect(queue.hasPending(8)).toBe(true); // queued
  expect(queue.hasPending(2)).toBe(false);
  d.resolve({ "1": ["A"], "8": "mo" });
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.hasPending(1)).toBe(false);
  expect(queue.hasPending(8)).toBe(false);
});

test("5xx retries with backoff and keeps newer values", async () => {
  let n = 0;
  const { queue, calls, statuses } = setup(async (batch) => {
    n += 1;
    if (n === 1) throw new ApiError(503, "http_error", "down");
    return Object.fromEntries(batch.map((a) => [String(a.question), a.value]));
  });
  queue.set(8, "old", { debounce: false });
  queue.set(9, "keep", { debounce: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls[0]).toEqual(
    expect.arrayContaining([
      { question: 8, value: "old" },
      { question: 9, value: "keep" },
    ]),
  );
  expect(statuses).toContain("retrying");
  queue.set(8, "new", { debounce: false });
  await vi.advanceTimersByTimeAsync(999);
  expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(
    expect.arrayContaining([
      { question: 8, value: "new" },
      { question: 9, value: "keep" },
    ]),
  );
  expect(statuses.at(-1)).toBe("saved");
});

test("backoff grows 1 s, 2 s, 4 s, 8 s, then every 15 s", async () => {
  const { queue, calls } = setup(async () => {
    throw new TypeError("fetch failed");
  });
  queue.set(1, ["A"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  const at: number[] = [];
  for (const wait of [1000, 2000, 4000, 8000, 15000, 15000]) {
    await vi.advanceTimersByTimeAsync(wait - 1);
    at.push(calls.length);
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(at).toEqual([1, 2, 3, 4, 5, 6]);
  expect(calls).toHaveLength(7);
});

test("409 session_closed stops everything", async () => {
  const { queue, calls, onClosed, statuses } = setup(async () => {
    throw new ApiError(409, "session_closed", "closed");
  });
  queue.set(8, "late", { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(onClosed).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toBe("closed");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toHaveLength(1);
  queue.set(8, "later", { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(1);
  // Nothing more can be saved, so flush lets the caller move on (submit → 409 → "already submitted").
  await expect(queue.flush()).resolves.toBe(true);
});

test("422 with extra.question drops only that item", async () => {
  let n = 0;
  const { queue, calls, onRejected } = setup(async (batch) => {
    n += 1;
    if (n === 1) throw new ApiError(422, "validation_error", "Too long", { question: 2 });
    return Object.fromEntries(batch.map((a) => [String(a.question), a.value]));
  });
  queue.set(1, "ok", { debounce: false });
  queue.set(2, "bad", { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(onRejected).toHaveBeenCalledWith(2, "Too long");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual([{ question: 1, value: "ok" }]);
});

test("401 is fatal and not retried", async () => {
  const err = new ApiError(401, "unauthorized", "no");
  const { queue, calls, onFatal, statuses } = setup(async () => {
    throw err;
  });
  queue.set(1, ["A"], { debounce: false });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls).toHaveLength(1);
  expect(onFatal).toHaveBeenCalledWith(err);
  expect(statuses.at(-1)).toBe("failed");
  await expect(queue.flush()).resolves.toBe(false);
});

test("onSaved receives normalized numeric keys", async () => {
  const { queue, onSaved } = setup(async () => ({ "21": ["B", "D"], "8": "moss" }));
  queue.set(21, ["B", "D"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(onSaved).toHaveBeenCalledWith({ 21: ["B", "D"], 8: "moss" });
});

test("dispose stops timers and ignores late responses", async () => {
  const d = deferred<Record<string, unknown>>();
  const { queue, calls, onSaved } = setup(() => d.promise);
  queue.set(1, ["A"], { debounce: false });
  queue.set(8, "mo", { debounce: true });
  await vi.advanceTimersByTimeAsync(0);
  queue.dispose();
  d.resolve({ "1": ["A"] });
  await vi.advanceTimersByTimeAsync(5000);
  expect(onSaved).not.toHaveBeenCalled();
  expect(calls).toHaveLength(1);
});

test("dispose hands unsent edits to sendOnDispose", async () => {
  const d = deferred<Record<string, unknown>>();
  const { queue, sendOnDispose } = setup(() => d.promise);
  queue.set(1, ["A"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  queue.set(8, "moss", { debounce: true });
  queue.set(1, ["B"], { debounce: false });
  queue.dispose();
  // Waits for the request in flight, so the older ["A"] can't land after ["B"].
  expect(sendOnDispose).not.toHaveBeenCalled();
  d.resolve({ "1": ["A"] });
  await vi.advanceTimersByTimeAsync(0);
  expect(sendOnDispose).toHaveBeenCalledWith([
    { question: 8, value: "moss" },
    { question: 1, value: ["B"] },
  ]);
});

test("dispose also resends an in-flight batch that then fails", async () => {
  const d = deferred<Record<string, unknown>>();
  const { queue, sendOnDispose } = setup(() => d.promise);
  queue.set(1, ["A"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  queue.dispose();
  d.reject(new TypeError("fetch failed"));
  await vi.advanceTimersByTimeAsync(0);
  expect(sendOnDispose).toHaveBeenCalledWith([{ question: 1, value: ["A"] }]);
});

test("dispose with nothing unsent, or after the session closed, sends nothing", async () => {
  const idle = setup();
  idle.queue.dispose();
  expect(idle.sendOnDispose).not.toHaveBeenCalled();

  const closed = setup(async () => {
    throw new ApiError(409, "session_closed", "closed");
  });
  closed.queue.set(1, ["A"], { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  closed.queue.set(2, ["B"], { debounce: false });
  closed.queue.dispose();
  expect(closed.sendOnDispose).not.toHaveBeenCalled();
});

test("a 422 that names no question drops the batch and keeps autosave running", async () => {
  let n = 0;
  const { queue, calls, onRejected, onFatal, statuses } = setup(async (batch) => {
    n += 1;
    if (n === 1) throw new ApiError(422, "validation_error", "Invalid answer");
    return Object.fromEntries(batch.map((a) => [String(a.question), a.value]));
  });
  queue.set(1, "bad", { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(onRejected).toHaveBeenCalledWith(null, "Invalid answer");
  expect(onFatal).not.toHaveBeenCalled();
  expect(statuses.at(-1)).toBe("saved");

  queue.set(2, "ok", { debounce: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual([{ question: 2, value: "ok" }]);
});
