import type { Metadata } from "next";
import { SkillFilter } from "@/components/tests/skill-filter";
import { TestCard } from "@/components/tests/test-card";
import { getServerApi } from "@/lib/api/server";
import type { Skill } from "@/lib/api/types";
import { unwrap } from "@/lib/api/unwrap";
import { SKILLS } from "@/lib/tests/skills";

export const metadata: Metadata = { title: "Tests · IELTS Practice" };

function parseSkill(value: string | string[] | undefined): Skill | null {
  return typeof value === "string" && (SKILLS as string[]).includes(value) ? (value as Skill) : null;
}

export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string | string[] }>;
}) {
  const skill = parseSkill((await searchParams).skill);
  const api = await getServerApi();
  const { items } = await unwrap(
    api.GET("/tests", { params: { query: { limit: 100, ...(skill ? { skill } : {}) } } }),
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Tests</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a test and take it in practice or exam mode.
      </p>
      <div className="mt-6">
        <SkillFilter active={skill} />
      </div>
      {items.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No published tests yet</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((test) => (
            <TestCard key={test.id} test={test} />
          ))}
        </div>
      )}
    </main>
  );
}
