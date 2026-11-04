import createClient from "openapi-fetch";
import type { paths } from "@/types/api";

// Absolute base: Node's fetch (used under test and during SSR) rejects relative URLs.
const origin = typeof window === "undefined" ? "" : window.location.origin;

/** Client for browser code. Every call goes through the Next.js proxy at /api/backend. */
export const api = createClient<paths>({
  baseUrl: `${origin}/api/backend`,
  // Look fetch up per call instead of capturing it once at import time.
  fetch: (request) => globalThis.fetch(request),
});
