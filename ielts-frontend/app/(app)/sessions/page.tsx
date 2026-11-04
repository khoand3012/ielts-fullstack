import type { Metadata } from "next";
import { SessionsTable } from "@/components/sessions/sessions-table";
import { getServerApi } from "@/lib/api/server";
import { unwrap } from "@/lib/api/unwrap";

export const metadata: Metadata = { title: "My sessions · IELTS Practice" };

const PAGE_SIZE = 20;

function parsePage(value: string | string[] | undefined): number {
  const page = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePage((await searchParams).page);
  const api = await getServerApi();
  const { items, total } = await unwrap(
    api.GET("/sessions", { params: { query: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE } } }),
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">My sessions</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your attempts, newest first.</p>
      <div className="mt-6">
        <SessionsTable items={items} total={total} page={page} pageSize={PAGE_SIZE} />
      </div>
    </main>
  );
}
