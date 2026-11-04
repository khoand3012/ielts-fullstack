import Link from "next/link";
import type { Skill } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { SKILL_LABELS, SKILLS } from "@/lib/tests/skills";

export function SkillFilter({ active }: { active: Skill | null }) {
  const options: { skill: Skill | null; label: string }[] = [
    { skill: null, label: "All" },
    ...SKILLS.map((skill) => ({ skill, label: SKILL_LABELS[skill] })),
  ];

  return (
    <nav aria-label="Filter by skill" className="flex flex-wrap gap-2">
      {options.map(({ skill, label }) => {
        const current = skill === active;
        return (
          <Link
            key={label}
            href={skill ? `/tests?skill=${skill}` : "/tests"}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              current
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
