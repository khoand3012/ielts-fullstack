// Read on the server only (not NEXT_PUBLIC_). Kept free of "server-only" so the
// Edge middleware can import it.
export const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/+$/, "");
