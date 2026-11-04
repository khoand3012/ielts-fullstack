import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { SessionRead } from "@/lib/api/types";

export function SubmittedView({ session }: { session: SessionRead }) {
  const timedOut = session.submit_reason === "timeout";
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-sm text-muted-foreground">{session.title}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {timedOut ? "Time's up — submitted" : "Submitted"}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {timedOut && "Your saved answers were submitted when time ran out. "}
        Results aren&apos;t available yet.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link href="/sessions">My sessions</Link>
        </Button>
        <Button asChild>
          <Link href="/tests">Back to tests</Link>
        </Button>
      </div>
    </main>
  );
}
