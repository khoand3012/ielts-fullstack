import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskEditor } from "@/components/writing/task-editor";

const baseTask = { number: 1, prompt: "Describe the chart.", min_words: 150, image: null };

function words(n: number): string {
  return Array.from({ length: n }, () => "w").join(" ");
}

describe("TaskEditor", () => {
  it("renders heading, prompt and labelled textbox", () => {
    render(<TaskEditor task={baseTask} value="" onChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Task 1" })).toBeInTheDocument();
    expect(screen.getByText("Describe the chart.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your answer for Task 1" })).toBeInTheDocument();
  });

  it("renders the image only when provided", () => {
    const { rerender } = render(
      <TaskEditor task={{ ...baseTask, image: "https://x.test/a.png" }} value="" onChange={() => {}} />,
    );
    expect(screen.getByAltText("Task 1 chart or diagram")).toHaveAttribute("src", "https://x.test/a.png");
    rerender(<TaskEditor task={baseTask} value="" onChange={() => {}} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("disables assistance attributes", () => {
    render(<TaskEditor task={baseTask} value="" onChange={() => {}} />);
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("spellcheck", "false");
    expect(box).toHaveAttribute("autocorrect", "off");
    expect(box).toHaveAttribute("autocapitalize", "off");
    expect(box).toHaveAttribute("autocomplete", "off");
  });

  it("calls onChange with typed text", async () => {
    const onChange = vi.fn();
    render(<TaskEditor task={baseTask} value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows short tone below the minimum", () => {
    render(<TaskEditor task={baseTask} value={words(87)} onChange={() => {}} />);
    const count = screen.getByText("87 / 150 words");
    expect(count).toHaveAttribute("data-tone", "short");
  });

  it("shows ok tone at the minimum", () => {
    render(<TaskEditor task={baseTask} value={words(150)} onChange={() => {}} />);
    expect(screen.getByText("150 / 150 words")).toHaveAttribute("data-tone", "ok");
  });

  it("clamps oversized paste and alerts, clearing when value drops", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TaskEditor task={baseTask} value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a".repeat(20001) } });
    expect(onChange).toHaveBeenCalledWith("a".repeat(20000));
    expect(screen.getByRole("alert")).toHaveTextContent(/too long/i);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<TaskEditor task={baseTask} value="abc" onChange={onChange} />);
  });

  it("renders prompt as text, not HTML", () => {
    const task = { ...baseTask, prompt: "<script>alert(1)</script>" };
    const { container } = render(<TaskEditor task={task} value="" onChange={() => {}} />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("supports readOnly", () => {
    render(<TaskEditor task={baseTask} value="x" onChange={() => {}} readOnly />);
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
  });
});
