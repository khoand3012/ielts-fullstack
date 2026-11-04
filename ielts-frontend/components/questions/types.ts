import type { AnswerValue } from "@/lib/answers/value";
import type { QuestionGroup } from "@/lib/content/schema";

export type AnswerChange = (
  question: number,
  value: AnswerValue,
  opts: { debounce: boolean },
) => void;

export type GroupProps = {
  group: QuestionGroup;
  answers: Record<number, AnswerValue>;
  onChange: AnswerChange;
};
