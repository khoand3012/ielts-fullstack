import type { Criterion } from "@/lib/api/types";

export type FeedbackComment = {
  id: string;
  criterion: Criterion;
  comment: string;
  quote: string | null;
  suggestion: string | null;
};

export type Highlight = { start: number; end: number; commentIds: string[] };
export type EssayParagraph = { text: string; highlights: Highlight[] };
/** Where a placed comment's own quote matched, in original offsets within its paragraph. */
export type QuoteRange = { paragraph: number; start: number; end: number };
export type PlacedEssay = {
  paragraphs: EssayParagraph[];
  unplaced: string[];
  /** Keyed by comment id; a comment attached to a highlight by overlap may cover a different span. */
  ranges: Record<string, QuoteRange>;
};

type Normalised = { norm: string; lower: string; map: number[] };

function normChar(ch: string): string {
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (ch === "–" || ch === "—") return "-";
  return ch;
}

// Lower-case one char at a time; keep the char itself if the length would change
// so `lower` stays index-aligned with `norm`.
function lowerChar(ch: string): string {
  const l = ch.toLowerCase();
  return l.length === ch.length ? l : ch;
}

function normalise(text: string): Normalised {
  let norm = "";
  let lower = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace) {
        norm += " ";
        lower += " ";
        map.push(i);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    const n = normChar(ch);
    norm += n;
    lower += lowerChar(n);
    map.push(i);
  }
  return { norm, lower, map };
}

function overlaps(h: Highlight, start: number, end: number): boolean {
  return h.start < end && start < h.end;
}

function addHighlight(
  list: Highlight[],
  start: number,
  end: number,
  id: string,
): Highlight[] {
  const existing = list.find((h) => overlaps(h, start, end));
  if (existing) {
    existing.commentIds.push(id);
    return list;
  }
  return [...list, { start, end, commentIds: [id] }].sort(
    (a, b) => a.start - b.start,
  );
}

export function placeComments(
  essay: string,
  comments: FeedbackComment[],
): PlacedEssay {
  const texts = essay
    .split(/\r?\n\s*\r?\n/)
    .map((t) => t.replace(/\r+$/, ""))
    .filter((t) => t.trim() !== "");
  const paragraphs: EssayParagraph[] = texts.map((text) => ({
    text,
    highlights: [],
  }));
  const normed = texts.map(normalise);
  const used = new Map<string, Set<string>>();
  const unplaced: string[] = [];
  const ranges: Record<string, QuoteRange> = {};

  function find(
    q: string,
    field: "norm" | "lower",
    taken: Set<string>,
  ): [number, number] | null {
    for (let p = 0; p < normed.length; p++) {
      const hay = normed[p][field];
      let from = 0;
      for (;;) {
        const idx = hay.indexOf(q, from);
        if (idx === -1) break;
        if (!taken.has(`${p}:${idx}`)) return [p, idx];
        from = idx + 1;
      }
    }
    return null;
  }

  for (const comment of comments) {
    const q = normalise(comment.quote?.trim() ?? "").norm;
    if (q === "") {
      unplaced.push(comment.id);
      continue;
    }
    const lq = q
      .split("")
      .map((ch) => lowerChar(ch))
      .join("");
    // One key for checking and marking, whichever path matches.
    const taken = used.get(lq) ?? new Set<string>();
    // Prefer an unused occurrence; if all are used, reuse the first so the
    // comment attaches to the existing highlight instead of going unplaced.
    const none = new Set<string>();
    const hit =
      find(q, "norm", taken) ??
      find(lq, "lower", taken) ??
      find(q, "norm", none) ??
      find(lq, "lower", none);
    if (!hit) {
      unplaced.push(comment.id);
      continue;
    }
    const [p, idx] = hit;
    const { map } = normed[p];
    const start = map[idx];
    const end = map[idx + q.length - 1] + 1;
    taken.add(`${p}:${idx}`);
    used.set(lq, taken);
    ranges[comment.id] = { paragraph: p, start, end };
    paragraphs[p].highlights = addHighlight(
      paragraphs[p].highlights,
      start,
      end,
      comment.id,
    );
  }

  return { paragraphs, unplaced, ranges };
}

/** `.`, `!` or `?` followed by whitespace or the paragraph end, so "2.5" and "e.g.in" don't split. */
function endsSentence(text: string, i: number): boolean {
  return /[.!?]/.test(text[i] ?? "") && (i + 1 === text.length || /\s/.test(text[i + 1]));
}

export function sentenceAround(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let s = start;
  while (s > 0 && !endsSentence(text, s - 1)) s--;
  while (s < start && /\s/.test(text[s])) s++;
  // Forwards: through the next terminator (the char before `e`), or the end.
  let e = Math.max(end, s);
  while (e < text.length && !endsSentence(text, e - 1)) e++;
  return { start: s, end: e };
}
