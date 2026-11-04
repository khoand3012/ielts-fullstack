"use client";

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
import { UnsavedAnswersError } from "@/lib/session/queries";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  unanswered: number;
  total: number;
  onConfirm(): void;
  pending: boolean;
  error: Error | null;
};

export function SubmitDialog({ open, onOpenChange, unanswered, total, onConfirm, pending, error }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit your answers?</DialogTitle>
          <DialogDescription>You can&apos;t change your answers after submitting.</DialogDescription>
        </DialogHeader>
        {unanswered > 0 && (
          <p className="text-sm font-medium">
            {unanswered} of {total} questions unanswered.
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof UnsavedAnswersError ? error.message : "Couldn't submit. Try again."}
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep working
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Submitting…" : "Submit answers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
