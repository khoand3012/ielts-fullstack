import type { QuestionGroup, QuestionItem, ReadingContent } from "./schema";

type ItemNumbers = Pick<QuestionItem, "numbers">;

/** Everything (saved answer, `question` sent) is keyed by the item's first number. */
export function itemKey(item: ItemNumbers): number {
  return item.numbers[0];
}

export function itemLabel(item: ItemNumbers): string {
  const first = item.numbers[0];
  const last = item.numbers[item.numbers.length - 1];
  return first === last ? String(first) : `${first}–${last}`;
}

/** A "Choose TWO letters" item spans two numbers and takes up to two options. */
export function itemMaxChoices(item: ItemNumbers): number {
  return item.numbers.length;
}

export type FlatItem = { key: number; label: string };

export function flattenItems(groups: QuestionGroup[]): FlatItem[] {
  return groups.flatMap((g) => g.questions.map((q) => ({ key: itemKey(q), label: itemLabel(q) })));
}

export function readingItems(content: ReadingContent): FlatItem[] {
  return flattenItems(content.passages.flatMap((p) => p.question_groups));
}
