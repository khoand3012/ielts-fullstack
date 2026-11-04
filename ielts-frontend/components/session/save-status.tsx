import type { SaveStatus as Status } from "@/lib/answers/save-queue";
import { cn } from "@/lib/utils";

const LABELS: Record<Status, string> = {
  saved: "Saved",
  pending: "Saving…",
  saving: "Saving…",
  retrying: "Offline — retrying",
  failed: "Not saved",
  closed: "Closed",
};

export function SaveStatus({ status }: { status: Status }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "text-xs text-muted-foreground",
        (status === "retrying" || status === "failed") && "font-medium text-destructive",
      )}
    >
      {LABELS[status]}
    </span>
  );
}
