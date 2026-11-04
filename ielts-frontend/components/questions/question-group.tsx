import { flattenItems } from "@/lib/content/items";
import { GapFillGroup } from "./gap-fill-group";
import { MatchingGroup } from "./matching-group";
import { MultipleChoiceGroup } from "./multiple-choice-group";
import { ShortAnswerGroup } from "./short-answer-group";
import type { GroupProps } from "./types";

function rangeLabel(group: GroupProps["group"]): string {
  const items = flattenItems([group]);
  const first = items[0]?.label.split("–")[0];
  const last = items.at(-1)?.label.split("–").at(-1);
  return first === last ? `Question ${first}` : `Questions ${first}–${last}`;
}

export function QuestionGroup(props: GroupProps) {
  const { group } = props;

  let body: React.ReactNode;
  if (group.type === "multiple_choice") body = <MultipleChoiceGroup {...props} />;
  else if (group.type === "matching") body = <MatchingGroup {...props} />;
  else if (group.type === "fill_blank" && group.context) body = <GapFillGroup {...props} />;
  else body = <ShortAnswerGroup {...props} />;

  return (
    <section className="grid gap-4">
      <header className="grid gap-1">
        <h3 className="text-sm font-semibold">{rangeLabel(group)}</h3>
        <p className="text-sm text-muted-foreground">{group.instructions}</p>
        {group.word_limit && (
          <p className="text-sm">
            Write <strong>{group.word_limit}</strong> for each answer.
          </p>
        )}
        {group.title && <p className="mt-2 font-medium">{group.title}</p>}
      </header>
      {body}
    </section>
  );
}
