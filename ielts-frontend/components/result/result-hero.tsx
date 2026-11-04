import { Badge } from "@/components/ui/badge";
import type { SessionResult, Skill } from "@/lib/api/types";
import { formatBand, formatDuration } from "@/lib/result/format";
import { SKILL_LABELS } from "@/lib/tests/skills";
import { cn } from "@/lib/utils";
import { BandRing } from "./band-ring";

const HERO_TINT: Record<Skill, string> = {
  reading: "from-skill-reading/15",
  listening: "from-skill-listening/15",
  writing: "from-skill-writing/15",
  speaking: "from-skill-speaking/15",
};

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

export function ResultHero({
  result,
  fixNext,
}: {
  result: SessionResult;
  fixNext: string[];
}) {
  const graded = result.status === "graded";
  const band = graded ? result.band : null;
  const hasScore = graded && result.raw_score !== null;
  return (
    <header
      className={cn(
        "grid gap-5 rounded-2xl border bg-linear-to-br via-card via-55% to-card p-4 sm:p-6",
        HERO_TINT[result.skill],
      )}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        <BandRing
          band={band}
          accent={result.skill}
          label={band === null ? "No band" : `Band ${formatBand(band)}`}
        />
        <div className="grid min-w-0 gap-2">
          <p className="text-sm text-muted-foreground">
            {SKILL_LABELS[result.skill]}
            {result.module &&
              (result.module === "academic"
                ? " · Academic"
                : " · General Training")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {result.title}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {result.mode === "exam" ? "Exam" : "Practice"}
            </Badge>
            {result.submit_reason === "timeout" && (
              <Badge variant="outline">Time ran out</Badge>
            )}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 sm:grid-cols-4">
        <Stat label="Band">{graded ? formatBand(result.band) : "—"}</Stat>
        {hasScore && result.max_score !== null && (
          <Stat label="Score">
            {result.raw_score}/{result.max_score}
          </Stat>
        )}
        {hasScore && result.max_score === null && (
          <Stat label="Raw score">{result.raw_score}</Stat>
        )}
        {result.answered !== null && (
          <Stat label="Answered">{result.answered}</Stat>
        )}
        <Stat label="Time spent">
          {formatDuration(result.time_spent_seconds)}
        </Stat>
      </dl>
      {graded && result.band === null && (
        <p className="text-sm text-muted-foreground">
          No band is given for this attempt (for example, a partial practice
          attempt).
        </p>
      )}
      {fixNext.length > 0 && (
        <section aria-labelledby="fix-next-heading" className="grid gap-2">
          <h2
            id="fix-next-heading"
            className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Fix these next
          </h2>
          <ol className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            {fixNext.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 rounded-xl border bg-card p-3 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background tabular-nums"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 whitespace-pre-wrap">{item}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </header>
  );
}
