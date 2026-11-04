/** What a question's answer is sent and stored as (see the handoff, §5). */
export type AnswerValue = string | string[] | null;

/**
 * Next selection after clicking `key`: unpicks a picked option; with one
 * allowed choice, replaces; otherwise adds until `max` and ignores further picks.
 */
export function toggleChoice(current: string[], key: string, max: number): string[] {
  if (current.includes(key)) return current.filter((k) => k !== key);
  if (max <= 1) return [key];
  if (current.length >= max) return current;
  return [...current, key];
}

export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim() !== "";
}

/** Saved answers arrive keyed by strings ("21"); the UI keys them by number. */
export function normalizeSaved(raw: Record<string, unknown>): Record<number, AnswerValue> {
  const out: Record<number, AnswerValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    const question = Number(key);
    if (!Number.isInteger(question)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      (Array.isArray(value) && value.every((v) => typeof v === "string"))
    ) {
      out[question] = value as AnswerValue;
    }
  }
  return out;
}
