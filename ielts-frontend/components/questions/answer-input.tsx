import { cn } from "@/lib/utils";

const MAX_TEXT_ANSWER = 200;

type Props = {
  question: number;
  value: string;
  onValueChange(value: string): void;
  className?: string;
};

/** Text answer for a gap or short answer; changes are debounced by the caller. */
export function AnswerInput({ question, value, onValueChange, className }: Props) {
  return (
    <input
      type="text"
      aria-label={`Question ${question}`}
      placeholder={String(question)}
      maxLength={MAX_TEXT_ANSWER}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={cn(
        "h-7 rounded-md border border-input bg-background px-2 text-sm outline-none placeholder:text-center placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    />
  );
}
