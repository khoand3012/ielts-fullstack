import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SessionRead } from "@/lib/api/types";
import { makeSession } from "@/tests/fixtures/session";
import { SessionsTable } from "./sessions-table";

function row(overrides: Partial<SessionRead>): SessionRead {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content, answers, ...read } = makeSession(overrides);
  return read;
}

test("an in-progress session links to Resume", () => {
  render(<SessionsTable items={[row({ id: "s-7" })]} total={1} page={1} pageSize={20} />);
  expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/sessions/s-7");
});

test("an exam in progress shows its deadline", () => {
  render(
    <SessionsTable
      items={[row({ mode: "exam", deadline: "2026-10-24T11:00:00Z" })]}
      total={1}
      page={1}
      pageSize={20}
    />,
  );
  const due = screen.getByText(/^Due\b/);
  expect(due.querySelector("time")).toHaveAttribute("dateTime", "2026-10-24T11:00:00Z");
});

test("a timed-out session says Time's up and links to its page", () => {
  render(
    <SessionsTable
      items={[
        row({
          id: "s-8",
          status: "submitted",
          submit_reason: "timeout",
          submitted_at: "2026-10-24T11:00:30Z",
        }),
      ]}
      total={1}
      page={1}
      pageSize={20}
    />,
  );
  const link = screen.getByRole("link", { name: "Time's up" });
  expect(link).toHaveAttribute("href", "/sessions/s-8");
});

test("on the last page there is no Next link and Previous goes back one page", () => {
  render(<SessionsTable items={[row({})]} total={45} page={3} pageSize={20} />);
  expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/sessions?page=2");
  expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
});

test("on the first page Next goes to page 2", () => {
  render(<SessionsTable items={[row({})]} total={45} page={1} pageSize={20} />);
  expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/sessions?page=2");
  expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
});

test("an empty list points to the tests", () => {
  render(<SessionsTable items={[]} total={0} page={1} pageSize={20} />);
  const empty = screen.getByText(/No attempts yet/);
  expect(within(empty).getByRole("link", { name: "start a test" })).toHaveAttribute("href", "/tests");
});
