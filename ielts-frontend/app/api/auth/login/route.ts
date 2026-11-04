import { NextResponse, type NextRequest } from "next/server";
import { backendPost, passThrough, unreachable } from "@/lib/auth/backend";
import { setAuthCookies } from "@/lib/auth/cookies";
import type { TokenPair } from "@/lib/auth/refresh";

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => ({}));
  let res: Response;
  try {
    res = await backendPost("/auth/login", body);
  } catch {
    return unreachable();
  }
  if (!res.ok) return passThrough(res);

  const pair = (await res.json()) as TokenPair;
  const out = new NextResponse(null, { status: 204 });
  setAuthCookies(out.cookies, pair);
  return out;
}
