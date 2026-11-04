import "server-only";
import createClient from "openapi-fetch";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { BACKEND_URL } from "@/lib/env";
import type { paths } from "@/types/api";

/**
 * Client for Server Components: calls the backend directly with the access
 * token from the cookie. Never refreshes — middleware has already done that.
 */
export async function getServerApi() {
  const access = (await cookies()).get(ACCESS_COOKIE)?.value;
  return createClient<paths>({
    baseUrl: BACKEND_URL,
    headers: access ? { Authorization: `Bearer ${access}` } : {},
    cache: "no-store",
  });
}
