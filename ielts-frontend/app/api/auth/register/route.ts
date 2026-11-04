import { NextResponse, type NextRequest } from "next/server";
import { backendPost, passThrough, unreachable } from "@/lib/auth/backend";
import { setAuthCookies } from "@/lib/auth/cookies";
import type { TokenPair } from "@/lib/auth/refresh";

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => ({}));
  try {
    const registered = await backendPost("/auth/register", body);
    if (!registered.ok) return passThrough(registered);

    const loggedIn = await backendPost("/auth/login", body);
    if (!loggedIn.ok) return passThrough(loggedIn);

    const out = new NextResponse(null, { status: 204 });
    setAuthCookies(out.cookies, (await loggedIn.json()) as TokenPair);
    return out;
  } catch {
    return unreachable();
  }
}
