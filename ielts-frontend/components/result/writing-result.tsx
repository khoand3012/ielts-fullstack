import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WritingCriterion, WritingResult, WritingTask } from "@/lib/api/types";
import { CRITERION_LABELS, formatBand } from "@/lib/result/format";

function CriterionBlock({ criterion }: { criterion: WritingCriterion }) {
  return (
    <li className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-medium">{CRITERION_LABELS[criterion.criterion]}</h4>
        <span className="text-sm font-semibold tabular-nums">
          <span className="sr-only">Band </span>
          {formatBand(criterion.band)}
        </span>
      </div>
      {criterion.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments for this criterion.</p>
      ) : (
        <ul className="grid gap-3">
          {criterion.comments.map((c, i) => (
            <li key={i} className="grid gap-1.5 text-sm">
              <p className="whitespace-pre-wrap">{c.comment}</p>
              {c.quote && (
                <blockquote className="border-l-2 pl-3 whitespace-pre-wrap text-muted-foreground italic">
                  {c.quote}
                </blockquote>
              )}
              {c.suggestion && (
                <p className="whitespace-pre-wrap">
                  <span className="font-medium">Suggestion: </span>
                  {c.suggestion}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function TaskCard({ task }: { task: WritingTask }) {
  const blank = task.band === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
          <h3>Task {task.number}</h3>
          <span className="text-sm font-normal text-muted-foreground">
            {task.word_count} {task.word_count === 1 ? "word" : "words"}
            {" · "}
            {blank ? "Not scored" : <>Band {formatBand(task.band)}</>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {blank && task.criteria.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This task was left blank, so it has no feedback.
          </p>
        ) : (
          <ul className="grid gap-3">
            {task.criteria.map((c) => (
              <CriterionBlock key={c.criterion} criterion={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function WritingResultView({ writing }: { writing: WritingResult }) {
  return (
    <div className="grid gap-6">
      {writing.focus.length > 0 && (
        <section aria-labelledby="focus-heading" className="grid gap-2">
          <h2 id="focus-heading" className="text-lg font-semibold">
            What to focus on
          </h2>
          <ol className="grid list-decimal gap-1 pl-5 text-sm">
            {writing.focus.map((f, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {f}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section aria-labelledby="tasks-heading" className="grid gap-4">
        <h2 id="tasks-heading" className="text-lg font-semibold">
          Feedback by task
        </h2>
        {writing.tasks.map((task) => (
          <TaskCard key={task.number} task={task} />
        ))}
      </section>
    </div>
  );
}
