"use client";

import { Button } from "@/components/ui/button";

export default function ResultError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong showing this result</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your answers are safe. Try again.</p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
