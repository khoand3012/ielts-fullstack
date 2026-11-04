import { toggleChoice } from "@/lib/answers/value";
import { itemKey, itemLabel, itemMaxChoices } from "@/lib/content/items";
import type { Option } from "@/lib/content/schema";
import { cn } from "@/lib/utils";
import { QuestionItem } from "./question-item";
import type { GroupProps } from "./types";

function OptionText({ option }: { option: Option }) {
  // TRUE/FALSE/NOT GIVEN options repeat the key as text; show it once.
  if (option.key === option.text) return <span>{option.text}</span>;
  return (
    <span>
      <span className="mr-2 font-semibold">{option.key}</span>
      {option.text}
    </span>
  );
}

const optionClass =
  "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted has-[:checked]:bg-primary/10 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";

export function MultipleChoiceGroup({ group, answers, onChange }: GroupProps) {
  return (
    <div className="grid gap-5">
      {group.questions.map((item) => {
        const key = itemKey(item);
        const max = itemMaxChoices(item);
        const options = item.options ?? group.options ?? [];
        const raw = answers[key];
        const selected = Array.isArray(raw) ? raw : [];
        const name = `q-${key}-choice`;

        return (
          <QuestionItem key={key} item={item}>
            {item.prompt && <p className="text-sm">{item.prompt}</p>}
            {max > 1 && <p className="text-xs font-medium text-muted-foreground">Choose {max}</p>}
            <div
              role={max > 1 ? "group" : "radiogroup"}
              aria-label={`Question ${itemLabel(item)}`}
              className={cn("grid gap-1", group.variant && "sm:grid-cols-3")}
            >
              {options.map((option) => {
                const checked = selected.includes(option.key);
                return (
                  <label key={option.key} className={optionClass}>
                    <input
                      type={max > 1 ? "checkbox" : "radio"}
                      name={name}
                      value={option.key}
                      checked={checked}
                      disabled={max > 1 && !checked && selected.length >= max}
                      onChange={() =>
                        onChange(key, toggleChoice(selected, option.key, max), { debounce: false })
                      }
                      className="mt-0.5 accent-primary"
                    />
                    <OptionText option={option} />
                  </label>
                );
              })}
            </div>
          </QuestionItem>
        );
      })}
    </div>
  );
}
