import { ApiError, toApiError } from "./errors";

type Credentials = { email: string; password: string };

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

async function post(path: string, body?: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${origin()}/api/auth/${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Network error — check your connection.");
  }
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
}

export const login = (body: Credentials) => post("login", body);
export const register = (body: Credentials) => post("register", body);
export const logout = () => post("logout");
