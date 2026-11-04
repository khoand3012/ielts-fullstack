export default function SessionLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8" aria-busy="true">
      <div className="h-7 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    </main>
  );
}
