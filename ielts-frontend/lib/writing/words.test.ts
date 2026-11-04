import { describe, expect, it } from "vitest";

import {
  MAX_ESSAY_CHARS,
  clampEssay,
  countWords,
  wordCountTone,
} from "@/lib/writing/words";

describe("countWords", () => {
  it("returns 0 for empty and whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("splits on any whitespace and ignores edges", () => {
    expect(countWords("one two  three\nfour\tfive")).toBe(5);
    expect(countWords("  padded words  ")).toBe(2);
  });

  it("counts hyphenated and non-ASCII words", () => {
    expect(countWords("well-known état")).toBe(2);
  });
});

describe("wordCountTone", () => {
  it("is short below the minimum and ok at or above it", () => {
    expect(wordCountTone(149, 150)).toBe("short");
    expect(wordCountTone(150, 150)).toBe("ok");
  });
});

describe("clampEssay", () => {
  it("leaves text at the limit untouched", () => {
    const text = "a".repeat(MAX_ESSAY_CHARS);
    expect(clampEssay(text)).toEqual({ text, truncated: false });
  });

  it("truncates text over the limit", () => {
    const result = clampEssay("a".repeat(MAX_ESSAY_CHARS + 1));
    expect(result.text).toHaveLength(MAX_ESSAY_CHARS);
    expect(result.truncated).toBe(true);
  });
});
