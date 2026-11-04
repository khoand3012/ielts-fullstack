const FALLBACK = "/tests";
const BASE = "http://same-origin.invalid";

/**
 * Only same-site relative paths are allowed as a post-login destination.
 * Parses with the URL parser the browser uses (which strips tabs and newlines
 * and treats "\" as "/") and checks the result stays on our origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || /[\x00-\x1f\\]/.test(next)) return FALLBACK;
  try {
    const url = new URL(next, BASE);
    // Dot segments can normalize "/.//evil.com" into "//evil.com", which a
    // browser would then read as another host.
    if (url.origin !== BASE || url.pathname.startsWith("//")) return FALLBACK;
    return url.pathname + url.search + url.hash;
  } catch {
    return FALLBACK;
  }
}
