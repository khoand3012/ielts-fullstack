"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ResultQuestion, ResultSection } from "@/lib/api/types";
import { answerList, questionLabel } from "@/lib/result/format";
import {
  type ChipState,
  chipState,
  questionTypeKey,
  questionTypeLabel,
  sectionMarks,
  sectionNumber,
  typeAccuracy,
} from "@/lib/result/question-stats";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<ChipState, string> = {
  correct: "Correct",
  partial: "Partly correct",
  wrong: "Incorrect",
  blank: "No answer",
};

/** Foreground text on 15% tints keeps 4.5:1 in both themes; blank also has a dashed border. */
const CHIP_CLASSES: Record<ChipState, string> = {
  correct: "border-state-correct bg-state-correct/15",
  partial: "border-state-partial bg-state-partial/15",
  wrong: "border-state-wrong bg-state-wrong/15",
  blank: "border-dashed border-muted-foreground/60 bg-transparent",
};

/** A shape per state, so colour is never the only signal: check, half-filled circle, cross, dash. */
function StateGlyph({ state }: { state: ChipState }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 shrink-0"
    >
      {state === "correct" && <path d="M2.5 6.5 5 9l4.5-5.5" />}
      {state === "partial" && (
        <>
          <circle cx="6" cy="6" r="4" />
          <path d="M6 2a4 4 0 0 0 0 8Z" fill="currentColor" stroke="none" />
        </>
      )}
      {state === "wrong" && <path d="m3 3 6 6M9 3 3 9" />}
      {state === "blank" && <path d="M3 6h6" />}
    </svg>
  );
}

function accuracyBarClass(ratio: number): string {
  if (ratio >= 0.85) return "bg-state-correct";
  if (ratio >= 0.7) return "bg-state-partial";
  return "bg-state-wrong";
}

function StudentAnswer({ q }: { q: ResultQuestion }) {
  const picks = answerList(q.answer);
  if (picks.length === 0)
    return <span className="text-muted-foreground">No answer</span>;
  if (q.kind === "choice") {
    const right = new Set(q.correct_choices ?? []);
    return (
      <ul className="grid gap-0.5">
        {picks.map((pick, i) => (
          <li key={`${pick}-${i}`}>
            {pick}{" "}
            <span className="text-xs text-muted-foreground">
              ({right.has(pick) ? "right" : "wrong"})
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return <span className="break-words">{picks.join(", ")}</span>;
}

function Accepted({ q }: { q: ResultQuestion }) {
  if (q.accepted.length === 0)
    return <span className="text-muted-foreground">—</span>;
  // A choice question has one correct set; text questions list alternative spellings.
  return (
    <span className="break-words">
      {q.accepted.join(q.kind === "choice" ? ", " : " / ")}
    </span>
  );
}

type Mode = "all" | "mistakes";

export function QuestionGrid({
  questions,
  sections,
  skill,
}: {
  questions: ResultQuestion[];
  sections: ResultSection[] | null;
  skill: "reading" | "listening";
}) {
  const ordered = useMemo(
    () => [...questions].sort((a, b) => a.number - b.number),
    [questions],
  );
  const mistakes = useMemo(
    () => ordered.filter((q) => chipState(q) !== "correct"),
    [ordered],
  );
  const groups = useMemo(
    () => sectionMarks(ordered, sections),
    [ordered, sections],
  );
  const accuracy = useMemo(() => typeAccuracy(ordered), [ordered]);
  const typeOptions = useMemo(
    () => [...accuracy].sort((a, b) => a.label.localeCompare(b.label)),
    [accuracy],
  );

  const [mode, setMode] = useState<Mode>("all");
  const [type, setType] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const cardRef = useRef<HTMLElement>(null);

  if (ordered.length === 0) return null;

  const selected =
    ordered.find((q) => q.number === selectedNumber) ??
    mistakes[0] ??
    ordered[0];
  const visible = (q: ResultQuestion) =>
    (mode === "all" || chipState(q) !== "correct") &&
    (type === "" || questionTypeKey(q) === type);
  const prevMistake = [...mistakes]
    .reverse()
    .find((q) => q.number < selected.number);
  const nextMistake = mistakes.find((q) => q.number > selected.number);
  const groupWord = skill === "reading" ? "Passage" : "Part";
  const selectedState = chipState(selected);

  const select = (q: ResultQuestion) => {
    setSelectedNumber(q.number);
    // On phones the card sits below the grid; on wide screens it is sticky, so this is a no-op.
    cardRef.current?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="grid min-w-0 gap-4">
        <h2 className="text-lg font-semibold">Question review</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Show"
            className="inline-flex gap-1 rounded-lg border bg-muted p-1"
          >
            {(
              [
                ["all", "All"],
                ["mistakes", "Mistakes only"],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "min-h-9 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors",
                  mode === value && "bg-background text-foreground shadow-sm",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Question type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">All types</option>
              {typeOptions.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul
          aria-label="Legend"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {(Object.keys(STATE_TEXT) as ChipState[]).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 place-items-center rounded-sm border-2 text-foreground",
                  CHIP_CLASSES[s],
                )}
              >
                <StateGlyph state={s} />
              </span>
              {STATE_TEXT[s]}
            </li>
          ))}
        </ul>

        {groups.map((g) => {
          const chips = ordered.filter(
            (q) => sectionNumber(q) === g.number && visible(q),
          );
          return (
            <section
              key={g.number}
              className="grid gap-3 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold">
                  {/* Old results have no sections: one group, no number. */}
                  {g.number === 0 ? "Questions" : `${groupWord} ${g.number}`}
                </h3>
                {g.title && (
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {g.title}
                  </p>
                )}
                <span className="ml-auto text-sm font-medium tabular-nums">
                  <span className="sr-only">Marks: </span>
                  {g.marks}/{g.max}
                </span>
              </div>
              {chips.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No questions match these filters.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
                  {chips.map((q) => {
                    const label = questionLabel(q.numbers, q.number);
                    const state = chipState(q);
                    const isSelected = q.number === selected.number;
                    return (
                      <button
                        key={q.number}
                        type="button"
                        aria-label={`${label}: ${STATE_TEXT[state]}`}
                        aria-pressed={isSelected}
                        onClick={() => select(q)}
                        className={cn(
                          // Phones: glyph above the label so "Q20–21" fits a quarter of a 360px screen.
                          "inline-flex min-h-10 min-w-10 flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-1 py-1 text-sm font-semibold tabular-nums text-foreground transition-shadow sm:flex-row sm:gap-1 sm:px-2",
                          "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                          CHIP_CLASSES[state],
                          isSelected &&
                            "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                        )}
                      >
                        <StateGlyph state={state} />
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="grid min-w-0 gap-4 lg:sticky lg:top-4">
        <section
          ref={cardRef}
          aria-label="Question detail"
          className="grid scroll-mt-4 gap-4 rounded-xl border bg-card p-4"
        >
          <div aria-live="polite" className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {questionLabel(selected.numbers, selected.number)}
            </h3>
            <span
              className={cn(
                "rounded-full border-2 px-2 py-0.5 text-xs font-medium text-foreground",
                CHIP_CLASSES[selectedState],
              )}
            >
              {STATE_TEXT[selectedState]}
            </span>
            <span className="text-xs text-muted-foreground">
              {questionTypeLabel(selected.question_type)}
            </span>
          </div>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Your answer</dt>
              <dd className="mt-0.5">
                <StudentAnswer q={selected} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Correct answer</dt>
              <dd className="mt-0.5">
                <Accepted q={selected} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Marks</dt>
              <dd className="mt-0.5 tabular-nums">
                {selected.marks}/{selected.max_marks}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!prevMistake}
              onClick={() => prevMistake && select(prevMistake)}
            >
              Previous mistake
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!nextMistake}
              onClick={() => nextMistake && select(nextMistake)}
            >
              Next mistake
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="type-accuracy-heading"
          className="grid gap-3 rounded-xl border p-4"
        >
          <h3 id="type-accuracy-heading" className="text-sm font-semibold">
            Accuracy by question type
          </h3>
          <ul className="grid gap-3">
            {accuracy.map((row) => {
              const ratio = row.max > 0 ? row.marks / row.max : 0;
              return (
                <li
                  key={row.type}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm"
                >
                  <span className="min-w-0">{row.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.marks}/{row.max}
                  </span>
                  <span
                    aria-hidden="true"
                    className="col-span-2 h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        accuracyBarClass(ratio),
                      )}
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
