import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResultQuestion } from "@/lib/api/types";
import { answerList, questionLabel, verdict } from "@/lib/result/format";

const VERDICT_LABEL = { correct: "Correct", partial: "Partly correct", incorrect: "Incorrect" };

function StudentAnswer({ q }: { q: ResultQuestion }) {
  const picks = answerList(q.answer);
  if (picks.length === 0) return <span className="text-muted-foreground">No answer</span>;
  if (q.kind === "choice") {
    const right = new Set(q.correct_choices ?? []);
    return (
      <ul className="grid gap-0.5">
        {picks.map((pick, i) => (
          <li key={`${pick}-${i}`}>
            {pick}{" "}
            <span className="text-xs text-muted-foreground">
              ({right.has(pick) ? "right" : "wrong"})
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return <span>{picks.join(", ")}</span>;
}

function Accepted({ q }: { q: ResultQuestion }) {
  if (q.accepted.length === 0) return <span className="text-muted-foreground">—</span>;
  // A choice question has one correct set; text questions list alternative spellings.
  return <span>{q.accepted.join(q.kind === "choice" ? ", " : " / ")}</span>;
}

export function ReadingResult({ questions }: { questions: ResultQuestion[] }) {
  return (
    <section aria-labelledby="review-heading" className="grid gap-3">
      <h2 id="review-heading" className="text-lg font-semibold">
        Question review
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Your answer</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Correct answer</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {questions.map((q) => {
            const v = verdict(q);
            return (
              <TableRow key={q.number}>
                <TableCell className="font-medium whitespace-nowrap">
                  {questionLabel(q.numbers, q.number)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <StudentAnswer q={q} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={v === "correct" ? "secondary" : v === "partial" ? "outline" : "destructive"}>
                    {VERDICT_LABEL[v]}
                  </Badge>{" "}
                  <span className="text-xs text-muted-foreground">
                    {q.marks}/{q.max_marks}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Accepted q={q} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
