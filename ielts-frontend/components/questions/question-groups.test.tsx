import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { AnswerValue } from "@/lib/answers/value";
import { parseContent, type QuestionGroup as Group } from "@/lib/content/schema";
import listeningRaw from "@/tests/fixtures/content/listening.json";
import readingRaw from "@/tests/fixtures/content/reading.json";
import { QuestionGroup } from "./question-group";

const reading = parseContent("reading", readingRaw);
const listening = parseContent("listening", listeningRaw);
if (reading.skill !== "reading" || listening.skill !== "listening") throw new Error("fixtures");

const tfng = reading.content.passages[0].question_groups[0];
const summary = reading.content.passages[0].question_groups[1];
const headings = reading.content.passages[1].question_groups[0];
const sentenceCompletion = reading.content.passages[1].question_groups[2];
const chooseTwo = listening.content.parts[2].question_groups[0];

function renderGroup(group: Group, answers: Record<number, AnswerValue> = {}) {
  const onChange = vi.fn();
  const view = render(<QuestionGroup group={group} answers={answers} onChange={onChange} />);
  return { onChange, ...view };
}

test("TRUE/FALSE/NOT GIVEN sends a one-item list immediately", async () => {
  const { onChange, rerender } = renderGroup(tfng);
  const q1 = screen.getByRole("radiogroup", { name: "Question 1" });
  await userEvent.click(within(q1).getByRole("radio", { name: "TRUE" }));
  expect(onChange).toHaveBeenLastCalledWith(1, ["TRUE"], { debounce: false });

  rerender(<QuestionGroup group={tfng} answers={{ 1: ["TRUE"] }} onChange={onChange} />);
  await userEvent.click(within(q1).getByRole("radio", { name: "FALSE" }));
  expect(onChange).toHaveBeenLastCalledWith(1, ["FALSE"], { debounce: false });
});

test("choose-two is labelled 21–22, keyed by 21, and capped at two", async () => {
  const { onChange, rerender } = renderGroup(chooseTwo);
  expect(screen.getByText("21–22")).toBeInTheDocument();
  expect(screen.getByText("Choose 2")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("checkbox", { name: /large portions/ }));
  expect(onChange).toHaveBeenLastCalledWith(21, ["B"], { debounce: false });

  rerender(<QuestionGroup group={chooseTwo} answers={{ 21: ["B"] }} onChange={onChange} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /unfamiliar dishes/ }));
  expect(onChange).toHaveBeenLastCalledWith(21, ["B", "D"], { debounce: false });

  rerender(<QuestionGroup group={chooseTwo} answers={{ 21: ["B", "D"] }} onChange={onChange} />);
  expect(screen.getByRole("checkbox", { name: /high prices/ })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /large portions/ })).toBeEnabled();
  expect(onChange.mock.calls.every(([q]) => q === 21)).toBe(true);
});

test("matching sends one option key as a string", async () => {
  const { onChange } = renderGroup(headings);
  // The shared option list is shown once, above the items.
  expect(screen.getByText("Temperature and the brain")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Question 14" }), "iii");
  expect(onChange).toHaveBeenLastCalledWith(14, "iii", { debounce: false });
});

test("matching can be cleared", async () => {
  const { onChange } = renderGroup(headings, { 14: "iii" });
  const select = screen.getByRole("combobox", { name: "Question 14" });
  expect(select).toHaveValue("iii");
  await userEvent.selectOptions(select, "");
  expect(onChange).toHaveBeenLastCalledWith(14, null, { debounce: false });
});

test("summary gaps become inputs inside the text", async () => {
  const { onChange } = renderGroup(summary);
  const inputs = [8, 9, 10, 11, 12, 13].map((n) =>
    screen.getByRole("textbox", { name: `Question ${n}` }),
  );
  expect(inputs).toHaveLength(6);
  expect(inputs[0]).toHaveAttribute("maxLength", "200");
  expect(screen.getByText(/Walls are valuable for wildlife/)).toBeInTheDocument();
  await userEvent.type(inputs[0], "m");
  expect(onChange).toHaveBeenLastCalledWith(8, "m", { debounce: true });
});

test("sentence-completion prompts get an input where the blank is", async () => {
  const { onChange } = renderGroup(sentenceCompletion);
  const input = screen.getByRole("textbox", { name: "Question 24" });
  expect(input).toHaveAttribute("maxLength", "200");
  expect(screen.queryByText(/____/)).not.toBeInTheDocument();
  await userEvent.type(input, "1");
  expect(onChange).toHaveBeenLastCalledWith(24, "1", { debounce: true });
});

test("saved answers are shown", () => {
  renderGroup(tfng, { 1: ["NOT GIVEN"] });
  const q1 = screen.getByRole("radiogroup", { name: "Question 1" });
  expect(within(q1).getByRole("radio", { name: "NOT GIVEN" })).toBeChecked();
  renderGroup(summary, { 8: "moss" });
  expect(screen.getByRole("textbox", { name: "Question 8" })).toHaveValue("moss");
});

test("instructions and word limit appear as written, and items have anchors", () => {
  const { container } = renderGroup(summary);
  expect(screen.getByText(summary.instructions)).toBeInTheDocument();
  expect(screen.getByText("ONE WORD ONLY", { selector: "strong, span, p" })).toBeInTheDocument();
  expect(container.querySelector("#q-8")).not.toBeNull();
});
