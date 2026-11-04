import type { Criterion, WritingCriterion } from "@/lib/api/types";
import {
  CRITERION_LABELS,
  CRITERION_SHORT,
  CRITERION_TONE,
  TONE_CLASSES,
  formatBand,
} from "@/lib/result/format";
import { cn } from "@/lib/utils";

export function CriterionBars({
  criteria,
  active,
  onToggle,
}: {
  criteria: WritingCriterion[];
  active: Criterion | null;
  onToggle(c: Criterion): void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        Tap a criterion to show only its highlights.
      </p>
      <div role="group" aria-label="Criteria" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {criteria.map((c) => {
          const pressed = active === c.criterion;
          return (
            <button
              key={c.criterion}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggle(c.criterion)}
              className={cn(
                "grid gap-2 rounded-lg border bg-card p-3 text-left text-sm transition-shadow",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                pressed && "border-foreground ring-1 ring-foreground",
              )}
            >
              <span className="flex items-baseline gap-2">
                <span aria-hidden="true" className="font-mono text-xs font-semibold">
                  {CRITERION_SHORT[c.criterion]}
                </span>{" "}
                <span className="min-w-0 flex-1">{CRITERION_LABELS[c.criterion]}</span>{" "}
                <span className="font-semibold tabular-nums">
                  <span className="sr-only">band</span> {formatBand(c.band)}
                </span>
              </span>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", TONE_CLASSES[CRITERION_TONE[c.criterion]].bar)}
                  style={{ width: `${Math.min(100, Math.max(0, (c.band / 9) * 100)).toFixed(1)}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
