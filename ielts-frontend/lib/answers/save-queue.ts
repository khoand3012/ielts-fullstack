import { ApiError } from "@/lib/api/errors";
import { normalizeSaved, type AnswerValue } from "./value";

export type SaveStatus = "saved" | "pending" | "saving" | "retrying" | "closed" | "failed";

type Batch = { question: number; value: AnswerValue }[];

export interface SaveQueueOptions {
  /** PUT /sessions/{id}/answers; resolves to the response's `answers`. */
  send(answers: Batch): Promise<Record<string, unknown>>;
  onSaved(saved: Record<number, AnswerValue>): void;
  onStatus(status: SaveStatus): void;
  /** 409 session_closed: the server has submitted the session. */
  onClosed(): void;
  /** 422: the named answer was dropped, or the whole batch when `question` is null. */
  onRejected(question: number | null, message: string): void;
  /** Any other 4xx (401/403/404). */
  onFatal(error: ApiError): void;
  /** Best-effort send of unsent edits when the queue is disposed (the student left). */
  sendOnDispose?(answers: Batch): void;
  debounceMs?: number;
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const MAX_RETRY_DELAY_MS = 15_000;

function isTransient(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
}

/**
 * Autosave engine for one session. At most one request is in flight; edits made
 * meanwhile are coalesced (last value per question wins) into the next request,
 * so an older response can never overwrite a newer edit on the server.
 * Network and 5xx failures are retried with backoff; 4xx never are.
 */
export class SaveQueue {
  private readonly opts: SaveQueueOptions;
  private readonly debounceMs: number;
  private pending = new Map<number, AnswerValue>();
  private inflight: Map<number, AnswerValue> | null = null;
  private inflightPromise: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private sendScheduled = false;
  private sendRequested = false;
  private lastAttemptFailed = false;
  private closed = false;
  private failed = false;
  private disposed = false;
  private status: SaveStatus = "saved";

  constructor(opts: SaveQueueOptions) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? 500;
  }

  set(question: number, value: AnswerValue, { debounce }: { debounce: boolean }): void {
    if (this.closed || this.failed || this.disposed) return;
    this.pending.set(question, value);

    if (debounce) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.requestSend();
      }, this.debounceMs);
    } else {
      this.requestSend();
    }
    this.updateStatus();
  }

  /**
   * Sends everything pending now (one attempt) and waits for it.
   * Resolves true when nothing is left unsaved — or when the session is closed,
   * since nothing more can be saved — and false when an answer is still unsaved
   * (offline, server error, fatal error). Never hangs on a dead network.
   */
  async flush(): Promise<boolean> {
    let attempted = false;
    for (;;) {
      if (this.disposed) return false;
      if (this.closed) return true;
      if (this.failed) return false;
      if (this.inflightPromise) {
        await this.inflightPromise;
        continue;
      }
      if (this.pending.size === 0) return true;
      if (attempted && this.lastAttemptFailed) return false;
      attempted = true;
      this.clearTimers();
      this.startSend();
    }
  }

  /** True while the question has an unsaved edit, queued or in flight. */
  hasPending(question: number): boolean {
    return this.pending.has(question) || (this.inflight?.has(question) ?? false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    // Wait for the request in flight so its older values can't land after ours.
    if (this.inflightPromise) void this.inflightPromise.then(() => this.sendUnsent());
    else this.sendUnsent();
  }

  private sendUnsent() {
    if (this.closed || this.failed || this.pending.size === 0) return;
    this.opts.sendOnDispose?.([...this.pending].map(([question, value]) => ({ question, value })));
  }

  private clearTimers() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  /** Sends on the next microtask, so edits made in the same tick share a request. */
  private requestSend() {
    if (this.inflight) {
      this.sendRequested = true;
      return;
    }
    if (this.retryTimer || this.sendScheduled) return; // a retry or send is already on its way
    this.sendScheduled = true;
    queueMicrotask(() => {
      this.sendScheduled = false;
      if (!this.inflight && !this.retryTimer) this.startSend();
    });
  }

  private startSend() {
    if (this.inflight || this.pending.size === 0 || this.closed || this.failed || this.disposed) {
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;

    const batch = this.pending;
    this.pending = new Map();
    this.inflight = batch;
    this.sendRequested = false;
    this.updateStatus();

    const answers: Batch = [...batch].map(([question, value]) => ({ question, value }));
    this.inflightPromise = this.opts.send(answers).then(
      (saved) => this.onSuccess(saved),
      (err: unknown) => this.onError(batch, err),
    );
  }

  private onSuccess(saved: Record<string, unknown>) {
    this.inflight = null;
    this.inflightPromise = null;
    if (this.disposed) return;
    this.retryAttempt = 0;
    this.lastAttemptFailed = false;
    this.opts.onSaved(normalizeSaved(saved));
    if (this.sendRequested && this.pending.size > 0) this.startSend();
    this.updateStatus();
  }

  private onError(batch: Map<number, AnswerValue>, err: unknown) {
    this.inflight = null;
    this.inflightPromise = null;
    if (this.disposed) {
      // Keep a failed batch for dispose's last send; a closed session takes nothing more.
      if (isTransient(err)) this.restore(batch);
      else if (err instanceof ApiError && err.status === 409) this.closed = true;
      return;
    }

    if (isTransient(err)) {
      this.lastAttemptFailed = true;
      this.restore(batch);
      const delay = RETRY_DELAYS_MS[this.retryAttempt] ?? MAX_RETRY_DELAY_MS;
      this.retryAttempt += 1;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.startSend();
      }, delay);
      this.updateStatus();
      return;
    }

    const apiErr = err as ApiError;
    if (apiErr.status === 409 && apiErr.code === "session_closed") {
      this.closed = true;
      this.pending.clear();
      this.clearTimers();
      this.updateStatus();
      this.opts.onClosed();
      return;
    }

    if (apiErr.status === 422) {
      const rejected = apiErr.extra.question;
      if (typeof rejected === "number" && batch.has(rejected)) {
        batch.delete(rejected);
        this.restore(batch);
        this.opts.onRejected(rejected, apiErr.message);
      } else {
        // We can't tell which answer was bad, so drop this batch and keep going.
        this.opts.onRejected(null, apiErr.message);
      }
      this.startSend();
      this.updateStatus();
      return;
    }

    this.failed = true;
    this.pending.clear();
    this.clearTimers();
    this.updateStatus();
    this.opts.onFatal(apiErr);
  }

  /** Puts a failed batch back without overwriting edits made since it was sent. */
  private restore(batch: Map<number, AnswerValue>) {
    for (const [question, value] of batch) {
      if (!this.pending.has(question)) this.pending.set(question, value);
    }
  }

  private updateStatus() {
    const next: SaveStatus = this.closed
      ? "closed"
      : this.failed
        ? "failed"
        : this.inflight
          ? "saving"
          : this.retryTimer
            ? "retrying"
            : this.pending.size > 0
              ? "pending"
              : "saved";
    if (next !== this.status) {
      this.status = next;
      this.opts.onStatus(next);
    }
  }
}
