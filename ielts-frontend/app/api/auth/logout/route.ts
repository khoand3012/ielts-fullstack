import { NextResponse, type NextRequest } from "next/server";
import { backendPost } from "@/lib/auth/backend";
import { clearAuthCookies, REFRESH_COOKIE } from "@/lib/auth/cookies";

async function signOut(req: NextRequest, out: NextResponse) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    // Revoking server-side is best effort: the cookies are cleared either way.
    await backendPost("/auth/logout", { refresh_token: refreshToken }).catch(() => undefined);
  }
  clearAuthCookies(out.cookies);
  return out;
}

export async function POST(req: NextRequest) {
  return signOut(req, new NextResponse(null, { status: 204 }));
}

/**
 * Navigable sign-out for Server Components whose token the backend rejected:
 * redirecting straight to /login would bounce back, since the refresh cookie is
 * still set.
 */
export async function GET(req: NextRequest) {
  return signOut(req, NextResponse.redirect(new URL("/login", req.url)));
}
