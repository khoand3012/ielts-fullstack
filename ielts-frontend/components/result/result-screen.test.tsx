import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Criterion, SessionResult } from "@/lib/api/types";
import { POLL_CAP_MS, pollDelay } from "@/lib/result/queries";
import { makeResult, makeWritingResult } from "@/tests/fixtures/result";
import { makeWritingSession } from "@/tests/fixtures/session";
import { server } from "@/tests/msw/server";
import { renderWithProviders } from "@/tests/render";
import { resetRouter, router } from "@/tests/router";
import { ResultScreen } from "./result-screen";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);
afterEach(() => vi.useRealTimers());

const URL = "*/api/backend/sessions/s-1/result";
const SESSION_URL = "*/api/backend/sessions/s-1";
const serve = (...results: SessionResult[]) => {
  let n = 0;
  server.use(
    // Writing results also read the session for task minimums; absent by default.
    http.get(SESSION_URL, () => HttpResponse.json({ error: { code: "not_found", message: "", extra: {} } }, { status: 404 })),
    http.get(URL, () => HttpResponse.json(results[Math.min(n++, results.length - 1)])),
  );
};
const apiError = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, extra: {} } }, { status });

const q20 = {
  number: 20,
  numbers: [20, 21],
  kind: "choice",
  answer: ["A", "C"],
  accepted: ["A", "B"],
  correct_choices: ["A"],
  marks: 1,
  max_marks: 2,
  section: 2,
  question_type: "multiple_choice",
} satisfies NonNullable<SessionResult["questions"]>[number];

const withQ20 = () => makeResult({ questions: [...makeResult().questions!, q20] });

test("graded Reading shows the hero and a chip per item", async () => {
  serve(withQ20());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("heading", { name: "Practice Test 1 — Academic Reading" })).toBeInTheDocument();
  expect(screen.getByText("5.5", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Band 5.5" })).toBeInTheDocument();
  expect(screen.getByText("1/2", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText("30 min 0 s")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Q1: Correct" })).toHaveTextContent(/^Q1$/);
  // Colour is not the only signal: every chip carries a decorative state glyph.
  for (const chip of screen.getAllByRole("button", { name: /^Q\d/ })) {
    expect(chip.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  expect(screen.getByRole("button", { name: "Q8: Incorrect" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Q20–21: Partly correct" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Passage 1" })).toBeInTheDocument();
  expect(screen.getByText("The history of glass")).toBeInTheDocument();
});

test("selecting a chip shows the answers; next mistake skips correct items", async () => {
  serve(withQ20());
  const user = userEvent.setup();
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  await user.click(await screen.findByRole("button", { name: "Q1: Correct" }));
  const card = within(screen.getByRole("region", { name: "Question detail" }));
  expect(card.getAllByText("TRUE")).toHaveLength(2);
  expect(card.getByText("True / False / Not given")).toBeInTheDocument();

  await user.click(card.getByRole("button", { name: "Next mistake" }));
  expect(card.getByText("moss")).toBeInTheDocument();
  expect(card.getByText("lichen / lichens")).toBeInTheDocument();

  await user.click(card.getByRole("button", { name: "Next mistake" }));
  expect(card.getByText("(right)")).toBeInTheDocument();
  expect(card.getByText("(wrong)")).toBeInTheDocument();
  expect(card.getByText("A, B")).toBeInTheDocument();

  await user.click(card.getByRole("button", { name: "Previous mistake" }));
  expect(card.getByText("moss")).toBeInTheDocument();
});

test("mistakes only hides correct chips", async () => {
  serve(withQ20());
  const user = userEvent.setup();
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  await screen.findByRole("button", { name: "Q1: Correct" });
  await user.click(screen.getByRole("button", { name: "Mistakes only" }));
  expect(screen.queryByRole("button", { name: "Q1: Correct" })).toBeNull();
  expect(screen.getByRole("button", { name: "Q8: Incorrect" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByRole("button", { name: "Q1: Correct" })).toBeInTheDocument();
});

test("type filter keeps only that type", async () => {
  serve(withQ20());
  const user = userEvent.setup();
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  await screen.findByRole("button", { name: "Q1: Correct" });
  await user.selectOptions(screen.getByLabelText("Question type"), "Gap fill");
  const chips = screen.getAllByRole("button", { name: /^Q\d/ });
  expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["Q8: Incorrect"]);
});

test("fix these next lists weakest types", async () => {
  serve(makeResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("heading", { name: "Fix these next" })).toBeInTheDocument();
  expect(screen.getByText("Gap fill: 0 of 1 right")).toBeInTheDocument();
});

test("Listening groups by part", async () => {
  serve(
    makeResult({ skill: "listening", module: null, sections: [{ number: 1, title: "Booking a room" }] }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("heading", { name: "Part 1" })).toBeInTheDocument();
  expect(screen.getByText("Booking a room")).toBeInTheDocument();
});

test("empty questions renders no grid", async () => {
  serve(makeResult({ questions: [] }));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("img", { name: "Band 5.5" })).toBeInTheDocument();
  expect(screen.queryByText("Accuracy by question type")).not.toBeInTheDocument();
  expect(screen.queryByText("Fix these next")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Q\d/ })).not.toBeInTheDocument();
});

test("null questions and null band still show the score with a note", async () => {
  serve(makeResult({ questions: null, max_score: null, band: null, answered: null, raw_score: 12 }));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText(/question-by-question review isn't available/)).toBeInTheDocument();
  expect(screen.getByText("Raw score")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText(/No band is given/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Q\d/ })).not.toBeInTheDocument();
});

test("polls while being graded, then shows the result and stops", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return HttpResponse.json(
        calls < 2
          ? makeResult({ status: "being_graded", raw_score: null, band: null, max_score: null, questions: null, answered: null })
          : makeResult(),
      );
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your result is being graded.");

  await vi.advanceTimersByTimeAsync(pollDelay(0) + 100);
  expect(await screen.findByRole("img", { name: "Band 5.5" })).toBeInTheDocument();
  expect(screen.queryByText("Your result is being graded")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your result is ready.");

  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(2);
});

test("a 409 sends the student back to the test", async () => {
  server.use(http.get(URL, () => apiError(409, "conflict")));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("This test is still in progress")).toBeInTheDocument();
  expect(router.replace).toHaveBeenCalledWith("/sessions/s-1");
});

test("a 404 shows not found without retrying", async () => {
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return apiError(404, "not_found");
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Result not found")).toBeInTheDocument();
  expect(calls).toBe(1);
});

const essayTab = (name: RegExp) => screen.findByRole("tab", { name });

test("graded Writing shows the essay with highlights", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const tab = await essayTab(/^Task 1 · 6\.0/);
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(tab).toHaveTextContent("172 words");
  // The highlights add no visible text: each paragraph reads exactly as written.
  expect(screen.getByText(/between 2000 and 2020/).textContent).toBe(
    "Overall, the graph go up between 2000 and 2020.",
  );
  expect(screen.getByText(/again in 2010/).textContent).toBe("The graph go up again in 2010.");
  expect(screen.getByRole("button", { name: "Task Achievement: the graph go up" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Grammatical Range and Accuracy: The graph go up" }),
  ).toBeInTheDocument();
  const fixNext = screen.getByRole("region", { name: "Fix these next" });
  expect(within(fixNext).getByText("Vary your sentence openings")).toBeInTheDocument();
  // Two focus items: the hero shows both, so the Writing view adds no "More to focus on".
  expect(screen.queryByRole("region", { name: "More to focus on" })).toBeNull();
});

const withTask1Words = (word_count: number) => {
  const base = makeWritingResult();
  return makeWritingResult({
    writing: {
      ...base.writing!,
      tasks: [{ ...base.writing!.tasks[0], word_count }, base.writing!.tasks[1]],
    },
  });
};

test("under-length task shows a warning chip", async () => {
  serve(withTask1Words(120));
  server.use(http.get(SESSION_URL, () => HttpResponse.json(makeWritingSession())));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const chip = await screen.findByText("Under 150 words");
  expect(screen.queryByText("Under 250 words")).toBeNull();
  // The chip is announced as its own phrase, after the word count.
  expect(screen.getByRole("tab", { name: /^Task 1 · 6\.0 120 words Under 150 words$/ })).toBeInTheDocument();
  // Theme tokens, not hard-coded palette colours; foreground text keeps 4.5:1 on the tint.
  expect(chip).toHaveClass("bg-state-partial/15", "text-foreground");
  expect(chip.className).not.toMatch(/amber/);
});

test("no chip when session content fails to load", async () => {
  serve(withTask1Words(120));
  server.use(http.get(SESSION_URL, () => apiError(500, "internal")));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await essayTab(/^Task 1 · 6\.0/)).toBeInTheDocument();
  expect(screen.queryByText(/Under \d+ words/)).toBeNull();
});

test("tapping a highlight opens the coach panel", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Task Achievement: the graph go up" }));
  expect(screen.getByText("You wrote")).toBeInTheDocument();
  expect(screen.getByText("Better")).toBeInTheDocument();
  expect(screen.getByText("Overall, the graph rises between 2000 and 2020.")).toBeInTheDocument();
  const panel = screen.getByRole("complementary", { name: "Highlight 1 of 2" });
  expect(within(panel).getByText("the graph go up", { selector: "mark" })).toBeInTheDocument();
  expect(screen.getByText("Covers the key trends.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Highlight 1 of 2" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Use the past tense for past years.")).toBeInTheDocument();
  expect(screen.getByText("The graph went up again in 2010.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByText("Tap a highlight to see the feedback")).toBeInTheDocument();
  // Next doesn't change the opener: focus goes back to the highlight that opened the panel.
  expect(screen.getByRole("button", { name: "Task Achievement: the graph go up" })).toHaveFocus();
});

test("Previous walks back through the highlights", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Grammatical Range and Accuracy: The graph go up" }),
  );
  expect(screen.getByRole("heading", { name: "Highlight 2 of 2" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("Covers the key trends.")).toBeInTheDocument();
  expect(screen.queryByText("Use the past tense for past years.")).toBeNull();
  // Previous is now disabled, so focus moves to the heading rather than being lost.
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "Highlight 1 of 2" })).toHaveFocus();
});

test("a highlight opens with Enter and with Space", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  const ta = await screen.findByRole("button", { name: "Task Achievement: the graph go up" });
  expect(ta).toHaveAttribute("tabindex", "0");
  ta.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByText("Covers the key trends.")).toBeInTheDocument();
  expect(screen.getByText("You wrote")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(ta).toHaveFocus();
  await user.keyboard(" ");
  expect(screen.getByText("You wrote")).toBeInTheDocument();
});

test("a placed comment without a suggestion shows no Better", async () => {
  // kind null = graded before kinds existed.
  const base = makeWritingResult();
  const [task1, task2] = base.writing!.tasks;
  serve(
    makeWritingResult({
      writing: {
        ...base.writing!,
        tasks: [
          {
            ...task1,
            criteria: task1.criteria.map((c) =>
              c.criterion === "grammatical_range_accuracy"
                ? { ...c, comments: [{ ...c.comments[0], kind: null, suggestion: "   " }] }
                : c,
            ),
          },
          task2,
        ],
      },
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Grammatical Range and Accuracy: The graph go up" }),
  );
  expect(screen.getByText("You wrote")).toBeInTheDocument();
  expect(screen.getByText("Use the past tense for past years.")).toBeInTheDocument();
  expect(screen.queryByText("Better")).toBeNull();
  // No suggestion means nothing to replace: the words are marked, not struck out as a mistake.
  const panel = screen.getByRole("complementary", { name: "Highlight 2 of 2" });
  const mark = within(panel).getByText("The graph go up", { selector: "mark" });
  expect(mark).not.toHaveClass("line-through");
  expect(within(panel).getByText("No change suggested for these words.")).toBeInTheDocument();
});

test("an improvement without a suggestion is marked, not struck out, with no 'No change suggested' line", async () => {
  serve(
    withTask1Comments({
      grammatical_range_accuracy: [
        { kind: "improvement", comment: "Use the past tense.", quote: "The graph go up", suggestion: null },
      ],
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Grammatical Range and Accuracy: The graph go up" }),
  );
  const panel = screen.getByRole("complementary", { name: /^Highlight/ });
  expect(within(panel).getByText("Use the past tense.")).toBeInTheDocument();
  expect(within(panel).queryByText("Better")).toBeNull();
  expect(within(panel).queryByText("No change suggested for these words.")).toBeNull();
  expect(within(panel).getByText("The graph go up", { selector: "mark" })).not.toHaveClass("line-through");
});

test("Escape closes the coach panel and returns focus to the highlight", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Task Achievement: the graph go up" }));
  expect(screen.getByText("You wrote")).toBeInTheDocument();
  // An Escape another overlay already handled leaves the panel open.
  const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  handled.preventDefault();
  act(() => {
    document.dispatchEvent(handled);
  });
  expect(screen.getByText("You wrote")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByText("You wrote")).toBeNull();
  expect(screen.getByRole("button", { name: "Task Achievement: the graph go up" })).toHaveFocus();
});

test("the comment list selects a placed comment", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Use the past tense for past years\./ }));
  expect(screen.getByText("The graph went up again in 2010.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Highlight 2 of 2" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Previous" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  // Opened from the list, so focus returns to that list item once the list is back.
  expect(screen.getByRole("button", { name: /^Use the past tense for past years\./ })).toHaveFocus();
});

test("criterion filter hides other highlights", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  const bars = await screen.findByRole("group", { name: "Criteria" });
  const gra = within(bars).getByRole("button", { name: /Grammatical Range and Accuracy/ });
  await user.click(gra);
  expect(gra).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryAllByRole("button", { name: /^Task Achievement:/ })).toHaveLength(0);
  expect(
    screen.getByRole("button", { name: "Grammatical Range and Accuracy: The graph go up" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Covers the key trends.")).toBeNull();

  await user.click(gra);
  expect(gra).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Task Achievement: the graph go up" })).toBeInTheDocument();
});

test("blank exam task shows the bars and no answer", async () => {
  const base = makeWritingResult();
  const zero = (criterion: Criterion) => ({ criterion, band: 0, comments: [] });
  serve(
    makeWritingResult({
      writing: {
        ...base.writing!,
        tasks: [
          base.writing!.tasks[0],
          {
            number: 2,
            band: 0,
            word_count: 0,
            text: "",
            criteria: [
              zero("task_response"),
              zero("coherence_cohesion"),
              zero("lexical_resource"),
              zero("grammatical_range_accuracy"),
            ],
          },
        ],
      },
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await essayTab(/^Task 2 · 0\.0/));
  expect(screen.getByText("No answer")).toBeInTheDocument();
  const bars = screen.getByRole("group", { name: "Criteria" });
  expect(within(bars).getByRole("button", { name: /Task Response/ })).toBeInTheDocument();
});

test("unplaced comments are listed", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const other = await screen.findByRole("region", { name: "Other comments on this task" });
  expect(within(other).getByText("No overview given.")).toBeInTheDocument();
});

test("selecting a comment scrolls its highlight into view, but Close does not", async () => {
  const original = Element.prototype.scrollIntoView;
  const scrolled: Element[] = [];
  const spy = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  Element.prototype.scrollIntoView = spy;
  try {
    serve(makeWritingResult());
    renderWithProviders(<ResultScreen sessionId="s-1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Covers the key trends\./ }));
    expect(spy).toHaveBeenLastCalledWith({ block: "center" });
    expect(scrolled.at(-1)).toBe(screen.getByRole("button", { name: "Task Achievement: the graph go up" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(spy).toHaveBeenLastCalledWith({ block: "center" });
    expect(scrolled.at(-1)).toBe(
      screen.getByRole("button", { name: "Grammatical Range and Accuracy: The graph go up" }),
    );

    const calls = spy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Tap a highlight to see the feedback")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(calls);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test("an old Reading result without sections or question types still renders", async () => {
  const strip = (q: NonNullable<SessionResult["questions"]>[number]) => {
    const raw: Record<string, unknown> = { ...q };
    delete raw.section;
    delete raw.question_type;
    return raw;
  };
  const raw: Record<string, unknown> = { ...makeResult() };
  raw.questions = makeResult().questions!.map(strip);
  delete raw.sections;
  serve(raw as unknown as SessionResult);
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByRole("img", { name: "Band 5.5" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Questions" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Q1: Correct" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Q8: Incorrect" })).toBeInTheDocument();
  expect(screen.getByText("Other: 1 of 2 right")).toBeInTheDocument();
  const accuracy = screen.getByRole("region", { name: "Accuracy by question type" });
  expect(within(accuracy).getByText("Other")).toBeInTheDocument();
  expect(document.body.innerHTML).not.toMatch(/undefined|NaN/);
  // The type filter matches questions with no type under "Other".
  await userEvent.setup().selectOptions(screen.getByLabelText("Question type"), "Other");
  expect(screen.getAllByRole("button", { name: /^Q\d/ })).toHaveLength(2);
});

test("an old Writing result whose tasks have no text shows No answer", async () => {
  const base = makeWritingResult();
  const tasks = base.writing!.tasks.map((t) => {
    const raw: Record<string, unknown> = { ...t };
    delete raw.text;
    return raw;
  });
  serve({ ...base, writing: { ...base.writing!, tasks } } as unknown as SessionResult);
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await essayTab(/^Task 1 · 6\.0/)).toBeInTheDocument();
  expect(screen.getByText("No answer")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Task Achievement:/ })).toBeNull();
  expect(document.body.innerHTML).not.toMatch(/undefined/);
});

test("blank practice task is not graded; switching task clears the selection", async () => {
  serve(makeWritingResult());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Task Achievement: the graph go up" }));
  await user.click(screen.getByRole("tab", { name: /^Task 2/ }));
  expect(screen.getByText("Not graded: no answer")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Criteria" })).toBeNull();
  await user.click(screen.getByRole("tab", { name: /^Task 1/ }));
  expect(screen.queryByText("You wrote")).toBeNull();
  expect(screen.getByText("Tap a highlight to see the feedback")).toBeInTheDocument();
});

test("more than three focus items lists the rest under More to focus on", async () => {
  const base = makeWritingResult();
  serve(makeWritingResult({ writing: { ...base.writing!, focus: ["One", "Two", "Three", "Four"] } }));
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const more = await screen.findByRole("region", { name: "More to focus on" });
  expect(within(more).getByText("Four")).toBeInTheDocument();
  expect(within(more).queryByText("Three")).toBeNull();
});

test("script-like text in answers, essays and comments renders as text", async () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const base = makeResult();
  serve(
    makeResult({ questions: [{ ...base.questions![1], answer: evil }] }),
    makeResult(),
  );
  const { unmount } = renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText(evil)).toBeInTheDocument();
  expect(document.querySelector("img, script")).toBeNull();
  unmount();

  serve(
    makeResult({
      skill: "writing",
      questions: null,
      writing: {
        focus: [evil],
        tasks: [
          {
            number: 1,
            band: 5,
            word_count: 3,
            text: `Intro. ${evil} and <script>alert(1)</script> end.`,
            criteria: [
              {
                criterion: "task_response",
                band: 5,
                comments: [{ comment: evil, quote: evil, suggestion: evil }],
              },
            ],
          },
        ],
      },
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  // Three: the hero's "Fix these next", the essay highlight, and the comment in the panel list.
  expect(await screen.findAllByText(evil)).toHaveLength(3);
  expect(screen.getByText(/and <script>alert\(1\)<\/script> end\./)).toBeInTheDocument();
  expect(document.querySelector("img, script")).toBeNull();
});

const pending = (overrides: Partial<SessionResult> = {}) =>
  makeResult({
    status: "being_graded",
    raw_score: null,
    band: null,
    max_score: null,
    questions: null,
    answered: null,
    ...overrides,
  });

test("a being-graded Writing result (writing null) keeps polling", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return HttpResponse.json(pending({ skill: "writing", module: null, grading_method: "ai" }));
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(pollDelay(0) + pollDelay(1) + pollDelay(2) + 500);
  await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
});

test("a 5xx while polling keeps the old data and shows the retry alert", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return calls === 1 ? HttpResponse.json(pending()) : apiError(500, "internal");
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(pollDelay(0) + 20_000); // the poll plus 3 backed-off retries
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't refresh this result");
  expect(screen.getByText("Your result is being graded")).toBeInTheDocument();
});

test("polling stops after the cap; Check again resumes it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls += 1;
      return HttpResponse.json(pending());
    }),
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  await screen.findByText("Your result is being graded");

  await vi.advanceTimersByTimeAsync(POLL_CAP_MS + 60_000);
  expect(await screen.findByText(/taking longer than expected/)).toBeInTheDocument();
  for (const link of screen.getAllByRole("link", { name: "My sessions" })) {
    expect(link).toHaveAttribute("href", "/sessions");
  }

  const stopped = calls;
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(calls).toBe(stopped);

  await user.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(calls).toBe(stopped + 1));
  expect(await screen.findByText("Your result is being graded")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBeGreaterThan(stopped + 1);
});

type Task1Comments = Partial<Record<Criterion, NonNullable<SessionResult["writing"]>["tasks"][number]["criteria"][number]["comments"]>>;

/** makeWritingResult() with the given criteria's Task 1 comments replaced. */
function withTask1Comments(replace: Task1Comments) {
  const base = makeWritingResult();
  const [task1, task2] = base.writing!.tasks;
  return makeWritingResult({
    writing: {
      ...base.writing!,
      tasks: [
        {
          ...task1,
          criteria: task1.criteria.map((c) => ({ ...c, comments: replace[c.criterion] ?? c.comments })),
        },
        task2,
      ],
    },
  });
}

const withStrength = () =>
  withTask1Comments({
    lexical_resource: [
      { kind: "strength", comment: "Good word choice.", quote: "between 2000 and 2020", suggestion: null },
    ],
  });

test("a strength highlight is green with a double underline and a Strength name", async () => {
  serve(withStrength());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const mark = await screen.findByRole("button", { name: "Strength, Lexical Resource: between 2000 and 2020" });
  expect(mark).toHaveClass("decoration-double");
  expect(mark).toHaveClass("bg-state-correct/15");
});

test("the coach panel shows a strength as What works, not struck out, with no Better", async () => {
  serve(withStrength());
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Strength, Lexical Resource/ }));
  const panel = screen.getByRole("complementary", { name: /^Highlight/ });
  expect(within(panel).getByText("What works")).toBeInTheDocument();
  expect(within(panel).queryByText("You wrote")).toBeNull();
  expect(within(panel).queryByText("Better")).toBeNull();
  expect(within(panel).queryByText("No change suggested for these words.")).toBeNull();
  expect(within(panel).getByText("between 2000 and 2020", { selector: "mark" })).not.toHaveClass("line-through");
});

test("a Task Achievement strength differs from a Task Achievement improvement without colour", async () => {
  serve(
    withTask1Comments({
      task_achievement: [
        { kind: "strength", comment: "Covers the key trends.", quote: "the graph go up", suggestion: null },
      ],
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const strength = await screen.findByRole("button", { name: /^Strength, Task Achievement:/ });
  expect(strength).toHaveClass("decoration-double");
  const improvement = screen.getByRole("button", { name: /^Grammatical Range and Accuracy:/ });
  expect(improvement.getAttribute("aria-label")).not.toMatch(/^Strength,/);
  expect(improvement).not.toHaveClass("decoration-double");
});

test("strengths are tagged in the comment list and in Other comments, without Better", async () => {
  serve(
    withTask1Comments({
      lexical_resource: [
        { kind: "strength", comment: "Good word choice.", quote: "between 2000 and 2020", suggestion: null },
      ],
      task_achievement: [
        { kind: "improvement", comment: "Covers the key trends.", quote: "the graph go up", suggestion: "the graph rises" },
        { kind: "strength", comment: "No overview given.", quote: null, suggestion: "Add an overview." },
      ],
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const item = await screen.findByRole("button", { name: /Good word choice\./ });
  expect(item).toHaveTextContent("Strength");
  const other = screen.getByRole("region", { name: "Other comments on this task" });
  expect(within(other).getByText("No overview given.").closest("li")).toHaveTextContent("Strength");
  // Same display variant as in the panel: a strength never shows a suggestion.
  expect(within(other).queryByText(/Better/)).toBeNull();
  // Improvements carry no tag.
  expect(screen.getByRole("button", { name: /Covers the key trends\./ })).not.toHaveTextContent("Strength");
});

test("an improvement attached to a strength highlight shows both in their own styles", async () => {
  serve(
    withTask1Comments({
      task_achievement: [
        { kind: "strength", comment: "Clear overview.", quote: "Overall, the graph go up", suggestion: null },
        { kind: "improvement", comment: "Covers the key trends.", quote: "the graph go up", suggestion: "the graph rises" },
      ],
    }),
  );
  renderWithProviders(<ResultScreen sessionId="s-1" />);
  const user = userEvent.setup();
  const mark = await screen.findByRole("button", {
    name: "Strength, Task Achievement: Overall, the graph go up",
  });
  expect(mark).toHaveClass("decoration-double");
  await user.click(mark);
  const panel = screen.getByRole("complementary", { name: /^Highlight/ });
  expect(within(panel).getAllByText("What works")).toHaveLength(1);
  expect(within(panel).getAllByText("Better")).toHaveLength(1);
  expect(within(panel).getAllByText("You wrote")).toHaveLength(1);
});

