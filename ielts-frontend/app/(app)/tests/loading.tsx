export default function TestsLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </main>
  );
}
