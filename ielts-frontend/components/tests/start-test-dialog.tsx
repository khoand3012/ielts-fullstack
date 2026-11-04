"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ApiError } from "@/lib/api/errors";
import type { SessionMode, TestSummary } from "@/lib/api/types";
import { useStartSession } from "@/lib/session/queries";

function startErrorMessage(err: ApiError): string {
  switch (err.status) {
    case 409:
      return "This test can't be started yet.";
    case 404:
      return "This test is no longer available.";
    case 429: {
      const resetsAt = err.extra.resets_at;
      if (typeof resetsAt !== "string") return "You've reached today's limit.";
      const time = new Date(resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `You've reached today's limit. It resets at ${time}.`;
    }
    default:
      return "Couldn't start the test. Try again.";
  }
}

type Props = {
  test: TestSummary;
  open: boolean;
  onOpenChange(open: boolean): void;
};

export function StartTestDialog({ test, open, onOpenChange }: Props) {
  const [mode, setMode] = useState<SessionMode>("practice");
  const start = useStartSession();
  // After success the router navigates away; keep the button disabled until it does.
  const busy = start.isPending || start.isSuccess;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{test.title}</DialogTitle>
          <DialogDescription>Choose how you want to take this test.</DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as SessionMode)}
          className="gap-3"
        >
          <Label
            htmlFor="mode-practice"
            className="flex items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem id="mode-practice" value="practice" className="mt-0.5" />
            <span className="grid gap-1">
              <span className="font-medium">Practice</span>
              <span className="text-sm font-normal text-muted-foreground">
                No timer. Submit when you&apos;re ready.
              </span>
            </span>
          </Label>
          <Label
            htmlFor="mode-exam"
            className="flex items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem id="mode-exam" value="exam" className="mt-0.5" />
            <span className="grid gap-1">
              <span className="font-medium">Exam</span>
              <span className="text-sm font-normal text-muted-foreground">
                {test.exam_time_limit_minutes}-minute countdown. Submitted automatically when time
                runs out.
              </span>
            </span>
          </Label>
        </RadioGroup>

        {start.error && (
          <Alert variant="destructive">
            <AlertDescription>{startErrorMessage(start.error)}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button disabled={busy} onClick={() => start.mutate({ test_id: test.id, mode })}>
            {busy ? "Starting…" : "Start test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
