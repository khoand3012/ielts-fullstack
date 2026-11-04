import { itemKey } from "@/lib/content/items";
import { QuestionItem } from "./question-item";
import type { GroupProps } from "./types";

export function MatchingGroup({ group, answers, onChange }: GroupProps) {
  const options = group.options ?? [];

  return (
    <div className="grid gap-5">
      <dl className="grid gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
        {options.map((option) => (
          <div key={option.key} className="flex gap-3">
            <dt className="w-8 shrink-0 font-semibold">{option.key}</dt>
            <dd>{option.text}</dd>
          </div>
        ))}
      </dl>
      {group.questions.map((item) => {
        const key = itemKey(item);
        const value = answers[key];
        return (
          <QuestionItem key={key} item={item}>
            <div className="flex flex-wrap items-center gap-3">
              {item.prompt && <p className="min-w-0 flex-1 text-sm">{item.prompt}</p>}
              <select
                aria-label={`Question ${key}`}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(key, e.target.value || null, { debounce: false })}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">—</option>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key}
                  </option>
                ))}
              </select>
            </div>
          </QuestionItem>
        );
      })}
    </div>
  );
}
