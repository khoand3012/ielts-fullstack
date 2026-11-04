import { expect, test } from "vitest";
import listening from "@/tests/fixtures/content/listening.json";
import { flattenItems, itemKey, itemLabel, itemMaxChoices } from "./items";
import { parseContent, type QuestionItem } from "./schema";

test("a choose-two item is keyed by its first number and labelled with both", () => {
  const item: QuestionItem = { numbers: [21, 22], prompt: "Which TWO?" };
  expect(itemKey(item)).toBe(21);
  expect(itemLabel(item)).toBe("21–22");
  expect(itemMaxChoices(item)).toBe(2);
});

test("a single item is labelled with its number", () => {
  expect(itemLabel({ numbers: [7] })).toBe("7");
});

test("flattenItems never yields the second number of a choose-two", () => {
  const parsed = parseContent("listening", listening);
  if (parsed.skill !== "listening") throw new Error("wrong skill");
  const keys = flattenItems(parsed.content.parts.flatMap((p) => p.question_groups)).map((i) => i.key);
  expect(keys.filter((k) => k === 21)).toHaveLength(1);
  expect(keys).not.toContain(22);
});
