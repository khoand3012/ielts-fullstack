import type { NextResponse } from "next/server";
import type { TokenPair } from "./refresh";

export const ACCESS_COOKIE = "ielts_access";
export const REFRESH_COOKIE = "ielts_refresh";

const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

type ResponseCookies = NextResponse["cookies"];

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

export function setAuthCookies(jar: ResponseCookies, pair: TokenPair): void {
  jar.set(ACCESS_COOKIE, pair.access_token, cookieOptions(ACCESS_MAX_AGE));
  jar.set(REFRESH_COOKIE, pair.refresh_token, cookieOptions(REFRESH_MAX_AGE));
}

export function clearAuthCookies(jar: ResponseCookies): void {
  jar.set(ACCESS_COOKIE, "", cookieOptions(0));
  jar.set(REFRESH_COOKIE, "", cookieOptions(0));
}
