export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalizes both error shapes the backend produces: its own
 * `{"error": {code, message, extra}}` and FastAPI's default `{"detail": [...]}`
 * for malformed request bodies.
 */
export function toApiError(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
    const { code, message, extra } = body.error;
    return new ApiError(
      status,
      code,
      typeof message === "string" ? message : code,
      isRecord(extra) ? extra : {},
    );
  }

  if (isRecord(body) && body.detail !== undefined) {
    const detail = body.detail;
    const first = Array.isArray(detail) ? detail[0] : undefined;
    const message =
      isRecord(first) && typeof first.msg === "string"
        ? first.msg
        : typeof detail === "string"
          ? detail
          : "Invalid request";
    return new ApiError(status, status === 422 ? "validation_error" : "http_error", message);
  }

  return new ApiError(status, "http_error", `Request failed with status ${status}`);
}
