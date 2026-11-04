import { NextResponse, type NextRequest } from "next/server";
import { unreachable } from "@/lib/auth/backend";
import { ACCESS_COOKIE, clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "@/lib/auth/cookies";
import { isExpiringSoon } from "@/lib/auth/jwt";
import { refreshTokens } from "@/lib/auth/refresh";

const PUBLIC_PAGES = new Set(["/login", "/register"]);

function signedOut(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/backend/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not signed in", extra: {} } },
      { status: 401 },
    );
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

/** The backend could not be reached to refresh: keep the cookies so a retry can work. */
function unavailable(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/backend/")) return unreachable();
  return new NextResponse("The server is unreachable right now. Reload the page in a moment.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "5" },
  });
}

/**
 * Keeps the access token fresh *before* anything renders. Server Components
 * cannot set cookies, and refresh tokens rotate, so this is the only safe place
 * for page requests to refresh.
 */
export async function middleware(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  if (PUBLIC_PAGES.has(req.nextUrl.pathname)) {
    return refreshToken ? NextResponse.redirect(new URL("/tests", req.url)) : NextResponse.next();
  }

  if (!refreshToken) return signedOut(req);
  if (!isExpiringSoon(req.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  const result = await refreshTokens(refreshToken);
  if (result.kind === "unavailable") return unavailable(req);
  if (result.kind === "rejected") {
    const out = signedOut(req);
    clearAuthCookies(out.cookies);
    return out;
  }
  const { pair } = result;

  // Rewrite the incoming request's cookies so this render sees the new token…
  req.cookies.set(ACCESS_COOKIE, pair.access_token);
  req.cookies.set(REFRESH_COOKIE, pair.refresh_token);
  const out = NextResponse.next({ request: { headers: req.headers } });
  // …and store them in the browser for the next request.
  setAuthCookies(out.cookies, pair);
  return out;
}

export const config = {
  matcher: ["/((?!_next|api/auth|favicon.ico|.*\\..*).*)"],
};
