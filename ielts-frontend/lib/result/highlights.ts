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
export type PlacedEssay = { paragraphs: EssayParagraph[]; unplaced: string[] };

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
  const hit = list.filter((h) => overlaps(h, start, end));
  const rest = list.filter((h) => !overlaps(h, start, end));
  const merged: Highlight = {
    start: Math.min(start, ...hit.map((h) => h.start)),
    end: Math.max(end, ...hit.map((h) => h.end)),
    commentIds: [...hit.flatMap((h) => h.commentIds), id],
  };
  return [...rest, merged].sort((a, b) => a.start - b.start);
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

  function find(q: string, field: "norm" | "lower"): [number, number] | null {
    const taken = used.get(q) ?? new Set<string>();
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
    let hit = find(q, "norm");
    if (!hit) {
      const lq = q
        .split("")
        .map((ch) => lowerChar(ch))
        .join("");
      hit = find(lq, "lower");
    }
    if (!hit) {
      unplaced.push(comment.id);
      continue;
    }
    const [p, idx] = hit;
    const { map } = normed[p];
    const start = map[idx];
    const end = map[idx + q.length - 1] + 1;
    const set = used.get(q) ?? new Set<string>();
    set.add(`${p}:${idx}`);
    used.set(q, set);
    paragraphs[p].highlights = addHighlight(
      paragraphs[p].highlights,
      start,
      end,
      comment.id,
    );
  }

  return { paragraphs, unplaced };
}

export function sentenceAround(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let s = start;
  while (s > 0 && !/[.!?]/.test(text[s - 1])) s--;
  while (s < start && /\s/.test(text[s])) s++;
  // Forwards: through the next terminator (the char before `e`), or the end.
  let e = Math.max(end, s);
  while (e < text.length && !/[.!?]/.test(text[e - 1] ?? "")) e++;
  return { start: s, end: e };
}
