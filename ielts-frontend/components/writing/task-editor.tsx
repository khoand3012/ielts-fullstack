"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import type { WritingContent } from "@/lib/content/schema";
import { MAX_ESSAY_CHARS, clampEssay, countWords, wordCountTone } from "@/lib/writing/words";
import { cn } from "@/lib/utils";

type Task = WritingContent["tasks"][number];

interface TaskEditorProps {
  task: Task;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function TaskEditor({ task, value, onChange, readOnly }: TaskEditorProps) {
  const tooLong = value.length >= MAX_ESSAY_CHARS;
  const textareaId = `task-${task.number}-answer`;
  const count = countWords(value);
  const tone = wordCountTone(count, task.min_words);

  function handleChange(next: string) {
    // Backstop only: maxLength makes the browser refuse overflow at the caret.
    onChange(clampEssay(next).text);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Task {task.number}</h2>
      <p className="whitespace-pre-line">{task.prompt}</p>
      {task.image ? (
        // Signed URL from the API; next/image is not used.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={task.image}
          alt={`Task ${task.number} chart or diagram`}
          className="max-h-96 max-w-full rounded-md border"
        />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={textareaId}>Your answer for Task {task.number}</Label>
        <textarea
          id={textareaId}
          value={value}
          readOnly={readOnly}
          maxLength={MAX_ESSAY_CHARS}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          onChange={(e) => handleChange(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 min-h-72 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-3 read-only:opacity-80"
        />
        <p
          data-tone={tone}
          className={cn(
            "text-sm font-medium",
            tone === "short" ? "text-amber-600" : "text-green-600",
          )}
        >
          {`${count} / ${task.min_words} words`}
        </p>
        {tooLong ? (
          <Alert variant="destructive">
            <AlertDescription>
              Your answer is too long. The limit is {MAX_ESSAY_CHARS.toLocaleString("en-US")} characters, so any extra text was not added.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
