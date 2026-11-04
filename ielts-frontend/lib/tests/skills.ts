import type { Skill } from "@/lib/api/types";

export const SKILLS: Skill[] = ["reading", "listening", "writing", "speaking"];

export const SKILL_LABELS: Record<Skill, string> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
};

/** Skills this frontend can run a session for. Grows as each skill's screen lands. */
export const PLAYABLE_SKILLS: ReadonlySet<Skill> = new Set<Skill>(["reading"]);
