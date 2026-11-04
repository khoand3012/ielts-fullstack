import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";

const NAV = [
  { href: "/tests", label: "Tests" },
  { href: "/sessions", label: "My sessions" },
];

export function AppHeader({ email }: { email: string }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/tests" className="font-semibold tracking-tight">
          IELTS Practice
        </Link>
        <nav className="flex gap-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
