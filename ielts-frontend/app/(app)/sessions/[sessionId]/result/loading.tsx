export default function ResultLoading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8" aria-busy="true">
      <div className="h-7 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-6 h-24 animate-pulse rounded-xl bg-muted" />
      <div className="mt-6 h-64 animate-pulse rounded-xl bg-muted" />
    </main>
  );
}
