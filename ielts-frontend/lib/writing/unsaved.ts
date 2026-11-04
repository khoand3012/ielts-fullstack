import type { AnswerValue } from "@/lib/answers/value";

/** Non-blank texts in `local` that the server has not stored in that exact form. */
export function unsavedTexts(
  local: Record<number, AnswerValue>,
  saved: Record<string, unknown>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(local)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (saved[key] === value) continue;
    out[Number(key)] = value;
  }
  return out;
}
