import type { Skill } from "@/lib/api/types";
import { formatBand } from "@/lib/result/format";

const ACCENT_STROKE: Record<Skill, string> = {
  reading: "stroke-skill-reading",
  listening: "stroke-skill-listening",
  writing: "stroke-skill-writing",
  speaking: "stroke-skill-speaking",
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The band as a ring filled to `band / max`; a null band draws only the track. */
export function BandRing({
  band,
  max = 9,
  accent,
  label,
}: {
  band: number | null;
  max?: number;
  accent: Skill;
  label: string;
}) {
  const fraction =
    band === null || max <= 0 ? 0 : Math.min(1, Math.max(0, band / max));
  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-label={label}
      className="size-28 shrink-0 sm:size-32"
    >
      <circle
        cx="64"
        cy="64"
        r={RADIUS}
        fill="none"
        strokeWidth="12"
        className="stroke-foreground/10"
      />
      {fraction > 0 && (
        <circle
          cx="64"
          cy="64"
          r={RADIUS}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(CIRCUMFERENCE * fraction).toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`}
          transform="rotate(-90 64 64)"
          className={ACCENT_STROKE[accent]}
        />
      )}
      <text
        x="64"
        y="68"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-foreground text-[34px] font-bold tabular-nums"
      >
        {formatBand(band)}
      </text>
    </svg>
  );
}
