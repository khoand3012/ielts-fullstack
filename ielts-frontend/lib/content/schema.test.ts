import { expect, test } from "vitest";
import listening from "@/tests/fixtures/content/listening.json";
import reading from "@/tests/fixtures/content/reading.json";
import writing from "@/tests/fixtures/content/writing.json";
import { readingItems } from "./items";
import { ContentError, parseContent } from "./schema";

test("the reading fixture parses", () => {
  const parsed = parseContent("reading", reading);
  if (parsed.skill !== "reading") throw new Error("wrong skill");
  expect(parsed.content.passages).toHaveLength(3);
  expect(parsed.content.passages[0].paragraphs[0].label).toBeNull();
  const items = readingItems(parsed.content);
  expect(items[0].key).toBe(1);
  expect(items.at(-1)?.key).toBe(40);
});

test("the listening fixture parses", () => {
  const parsed = parseContent("listening", listening);
  if (parsed.skill !== "listening") throw new Error("wrong skill");
  expect(parsed.content.parts).toHaveLength(4);
  expect(parsed.content.parts[0].audio).toBeNull();
});

test("the writing fixture parses", () => {
  const parsed = parseContent("writing", writing);
  if (parsed.skill !== "writing") throw new Error("wrong skill");
  expect(parsed.content.tasks.map((t) => t.min_words)).toEqual([150, 250]);
});

test("an unknown variant still parses (it is only a rendering hint)", () => {
  const content = structuredClone(reading);
  (content.passages[0].question_groups[0] as { variant?: string }).variant = "something_new";
  expect(() => parseContent("reading", content)).not.toThrow();
});

test("speaking is not parseable yet", () => {
  expect(() => parseContent("speaking", {})).toThrow(ContentError);
});

test("an invalid shape throws ContentError", () => {
  expect(() => parseContent("reading", { passages: [{}] })).toThrow(ContentError);
});
