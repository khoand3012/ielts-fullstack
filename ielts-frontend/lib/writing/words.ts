export const MAX_ESSAY_CHARS = 20000;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

export function wordCountTone(count: number, min: number): "short" | "ok" {
  return count < min ? "short" : "ok";
}

export function clampEssay(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_ESSAY_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_ESSAY_CHARS), truncated: true };
}
