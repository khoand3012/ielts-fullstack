import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/auth/proxy";

type Context = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Context) {
  return proxyToBackend(req, (await params).path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
