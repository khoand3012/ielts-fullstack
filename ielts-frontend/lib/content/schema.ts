import { z } from "zod";
import type { Skill } from "@/lib/api/types";

// `content` is untyped in the OpenAPI schema; these mirror the backend's shapes
// (see the handoff, §5). Unknown keys are stripped.

const OptionSchema = z.object({ key: z.string(), text: z.string() });

const QuestionItemSchema = z.object({
  numbers: z.array(z.number().int()).min(1),
  prompt: z.string().nullable(),
  options: z.array(OptionSchema).nullish(),
});

const QuestionGroupSchema = z.object({
  type: z.enum(["multiple_choice", "fill_blank", "matching", "short_answer"]),
  // A rendering hint only (true_false_not_given, yes_no_not_given, headings,
  // sentence_endings); an unknown value must not break the test.
  variant: z.string().nullish(),
  instructions: z.string(),
  title: z.string().nullish(),
  context: z.string().nullish(),
  word_limit: z.string().nullish(),
  options: z.array(OptionSchema).nullish(),
  questions: z.array(QuestionItemSchema).min(1),
});

const ReadingContentSchema = z.object({
  passages: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      paragraphs: z.array(z.object({ label: z.string().nullable(), text: z.string() })),
      question_groups: z.array(QuestionGroupSchema),
    }),
  ),
});

const ListeningContentSchema = z.object({
  parts: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      audio: z.string().nullable(),
      question_groups: z.array(QuestionGroupSchema),
    }),
  ),
});

const WritingContentSchema = z.object({
  tasks: z.array(
    z.object({
      number: z.number().int(),
      prompt: z.string(),
      min_words: z.number().int(),
      image: z.string().nullable(),
    }),
  ),
});

export type Option = z.infer<typeof OptionSchema>;
export type QuestionItem = z.infer<typeof QuestionItemSchema>;
export type QuestionGroup = z.infer<typeof QuestionGroupSchema>;
export type ReadingContent = z.infer<typeof ReadingContentSchema>;
export type ListeningContent = z.infer<typeof ListeningContentSchema>;
export type WritingContent = z.infer<typeof WritingContentSchema>;

export type ParsedContent =
  | { skill: "reading"; content: ReadingContent }
  | { skill: "listening"; content: ListeningContent }
  | { skill: "writing"; content: WritingContent };

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentError";
  }
}

function parseWith<T>(schema: z.ZodType<T>, content: unknown, skill: Skill): T {
  const result = schema.safeParse(content);
  if (!result.success) {
    throw new ContentError(`Invalid ${skill} content: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseContent(skill: Skill, content: unknown): ParsedContent {
  switch (skill) {
    case "reading":
      return { skill, content: parseWith(ReadingContentSchema, content, skill) };
    case "listening":
      return { skill, content: parseWith(ListeningContentSchema, content, skill) };
    case "writing":
      return { skill, content: parseWith(WritingContentSchema, content, skill) };
    default:
      throw new ContentError(`Unsupported skill: ${skill}`);
  }
}
