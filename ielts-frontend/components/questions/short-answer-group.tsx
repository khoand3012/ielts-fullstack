import { itemKey } from "@/lib/content/items";
import { AnswerInput } from "./answer-input";
import { QuestionItem } from "./question-item";
import type { GroupProps } from "./types";

const BLANK = /_{2,}/;

export function ShortAnswerGroup({ group, answers, onChange }: GroupProps) {
  return (
    <div className="grid gap-4">
      {group.questions.map((item) => {
        const key = itemKey(item);
        const value = answers[key];
        const input = (
          <AnswerInput
            question={key}
            value={typeof value === "string" ? value : ""}
            onValueChange={(text) => onChange(key, text, { debounce: true })}
            className="mx-1 w-40"
          />
        );
        const prompt = item.prompt ?? "";
        const blank = prompt.match(BLANK);

        return (
          <QuestionItem key={key} item={item}>
            {blank?.index !== undefined ? (
              // Sentence completion: put the input where the blank is.
              <p className="text-sm leading-8">
                {prompt.slice(0, blank.index)}
                {input}
                {prompt.slice(blank.index + blank[0].length)}
              </p>
            ) : (
              <div className="grid gap-2 text-sm">
                {prompt && <p>{prompt}</p>}
                <div>{input}</div>
              </div>
            )}
          </QuestionItem>
        );
      })}
    </div>
  );
}
