import { isAnswered, type AnswerValue } from "@/lib/answers/value";
import type { FlatItem } from "@/lib/content/items";
import { cn } from "@/lib/utils";

type Props = {
  items: FlatItem[];
  answers: Record<number, AnswerValue>;
  onSelect(key: number): void;
};

export function QuestionNav({ items, answers, onSelect }: Props) {
  return (
    <nav aria-label="Questions" className="flex flex-wrap gap-1">
      {items.map((item) => {
        const answered = isAnswered(answers[item.key]);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-label={`Go to question ${item.label}${answered ? ", answered" : ""}`}
            className={cn(
              "h-7 min-w-7 rounded-md border px-1 text-xs tabular-nums transition-colors",
              answered
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
