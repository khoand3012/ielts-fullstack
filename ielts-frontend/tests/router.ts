import { vi } from "vitest";

/** A stand-in for next/navigation's router; use with vi.mock("next/navigation"). */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

export function resetRouter() {
  for (const fn of Object.values(router)) fn.mockReset();
}
