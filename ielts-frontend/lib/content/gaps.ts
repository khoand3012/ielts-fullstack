export type GapToken = { kind: "text"; text: string } | { kind: "gap"; number: number };

/** Splits summary text with `{8}`-style markers into text runs and gaps. */
export function parseGapContext(context: string): GapToken[] {
  // With a capture group, split() puts the captured numbers at the odd indexes.
  return context.split(/\{(\d+)\}/).flatMap((part, i): GapToken[] => {
    if (i % 2 === 1) return [{ kind: "gap", number: Number(part) }];
    return part ? [{ kind: "text", text: part }] : [];
  });
}
