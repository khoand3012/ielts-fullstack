import { expect, test } from "vitest";
import { unsavedTexts } from "./unsaved";

test("returns only texts that differ from the saved ones", () => {
  expect(unsavedTexts({ 1: "a", 2: "b" }, { 1: "a" })).toEqual({ 2: "b" });
});

test("identical, empty and whitespace-only texts give nothing", () => {
  expect(unsavedTexts({ 1: "a" }, { 1: "a" })).toEqual({});
  expect(unsavedTexts({ 1: "", 2: "   \n" }, {})).toEqual({});
});

test("ignores non-string answers", () => {
  expect(unsavedTexts({ 1: ["A"], 2: null }, {})).toEqual({});
});

test("a text edited after the saved version counts as unsaved", () => {
  expect(unsavedTexts({ 2: "new" }, { 2: "old" })).toEqual({ 2: "new" });
});
