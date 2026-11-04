import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ApiError } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import { unwrap } from "@/lib/api/unwrap";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const api = await getServerApi();
  let email: string;
  try {
    email = (await unwrap(api.GET("/auth/me"))).email;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/api/auth/logout");
    throw err;
  }

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader email={email} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
