import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SessionRead } from "@/lib/api/types";
import { SKILL_LABELS } from "@/lib/tests/skills";

type Props = {
  items: SessionRead[];
  total: number;
  page: number;
  pageSize: number;
};

function StatusCell({ session }: { session: SessionRead }) {
  if (session.status === "in_progress") {
    return (
      <div className="grid gap-1">
        <Link href={`/sessions/${session.id}`} className="font-medium underline underline-offset-4">
          Resume
        </Link>
        {session.deadline && (
          <span className="text-xs text-muted-foreground">
            Due <LocalTime iso={session.deadline} />
          </span>
        )}
      </div>
    );
  }
  return (
    <Link href={`/sessions/${session.id}`} className="underline-offset-4 hover:underline">
      {session.submit_reason === "timeout" ? "Time's up" : "Submitted"}
    </Link>
  );
}

export function SessionsTable({ items, total, page, pageSize }: Props) {
  if (items.length === 0 && page === 1) {
    return (
      <p className="mt-10 text-center text-sm text-muted-foreground">
        No attempts yet —{" "}
        <Link href="/tests" className="font-medium text-foreground underline underline-offset-4">
          start a test
        </Link>
      </p>
    );
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test</TableHead>
            <TableHead>Skill</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((session) => (
            <TableRow key={session.id}>
              <TableCell className="max-w-64 truncate font-medium">{session.title}</TableCell>
              <TableCell>{SKILL_LABELS[session.skill]}</TableCell>
              <TableCell>
                <Badge variant="outline">{session.mode === "exam" ? "Exam" : "Practice"}</Badge>
              </TableCell>
              <TableCell>
                <LocalTime iso={session.started_at} />
              </TableCell>
              <TableCell>
                {session.submitted_at ? <LocalTime iso={session.submitted_at} /> : "—"}
              </TableCell>
              <TableCell>
                <StatusCell session={session} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/sessions?page=${page - 1}`}>Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/sessions?page=${page + 1}`}>Next</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
