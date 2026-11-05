import type { components } from "@/types/api";

type Schemas = components["schemas"];

export type SessionRead = Schemas["SessionRead"];
export type SessionDetail = Schemas["SessionDetail"];
export type TestSummary = Schemas["TestSummary"];
export type Skill = Schemas["Skill"];
export type SessionMode = Schemas["SessionMode"];
export type AnswerInput = Schemas["AnswerInput"];
export type UserRead = Schemas["UserRead"];
export type Module = Schemas["Module"];
export type SessionResult = Schemas["SessionResult"];
export type ResultQuestion = Schemas["ResultQuestion"];
export type WritingResult = Schemas["WritingResultView"];
export type WritingTask = Schemas["WritingTaskView"];
export type ResultSection = Schemas["ResultSection"];
export type WritingCriterion = Schemas["WritingCriterion"];
export type WritingComment = Schemas["WritingComment"];
export type Criterion = Schemas["Criterion"];
export type CommentKind = Schemas["CommentKind"];
