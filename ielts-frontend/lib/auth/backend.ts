import { NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/env";

/** POSTs JSON to the backend from a route handler. */
export function backendPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/** Copies a backend response (status, body, content type) into a NextResponse. */
export async function passThrough(res: Response): Promise<NextResponse> {
  const body = res.status === 204 || res.status === 304 ? null : await res.arrayBuffer();
  const headers = new Headers();
  const contentType = res.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return new NextResponse(body, { status: res.status, headers });
}

export function unreachable(): NextResponse {
  return NextResponse.json(
    { error: { code: "bad_gateway", message: "The server is unreachable. Try again.", extra: {} } },
    { status: 502 },
  );
}
