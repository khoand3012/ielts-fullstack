"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { TestSummary } from "@/lib/api/types";
import { PLAYABLE_SKILLS, SKILL_LABELS } from "@/lib/tests/skills";
import { StartTestDialog } from "./start-test-dialog";

export function TestCard({ test }: { test: TestSummary }) {
  const [open, setOpen] = useState(false);
  const playable = PLAYABLE_SKILLS.has(test.skill);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{SKILL_LABELS[test.skill]}</Badge>
          {!playable && <Badge variant="outline">Coming soon</Badge>}
        </div>
        <CardTitle className="mt-2 leading-snug">{test.title}</CardTitle>
        <CardDescription>Exam: {test.exam_time_limit_minutes} min</CardDescription>
      </CardHeader>
      {playable && (
        <CardFooter>
          <Button onClick={() => setOpen(true)}>Start</Button>
          {open && <StartTestDialog test={test} open={open} onOpenChange={setOpen} />}
        </CardFooter>
      )}
    </Card>
  );
}
