import { ApiError, toApiError } from "./errors";

type ClientResult<T> = { data?: T; error?: unknown; response: Response };

/** Resolves an openapi-fetch result to its data, or throws an ApiError. */
export async function unwrap<T>(request: Promise<ClientResult<T>>): Promise<T> {
  let result: ClientResult<T>;
  try {
    result = await request;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(0, "network", "Network error — check your connection.");
  }

  if (!result.response.ok || result.error !== undefined) {
    throw toApiError(result.response.status, result.error);
  }
  return result.data as T;
}
