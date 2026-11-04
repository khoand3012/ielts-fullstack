"use client";

import { Button } from "@/components/ui/button";

export default function TestsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Couldn&apos;t load tests</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
