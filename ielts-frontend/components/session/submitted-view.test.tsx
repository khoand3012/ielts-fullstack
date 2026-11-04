import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { makeSession } from "@/tests/fixtures/session";
import { resetRouter, router } from "@/tests/router";
import { SubmittedView } from "./submitted-view";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);

test("redirects to the result page exactly once, even across re-renders", () => {
  const session = makeSession({ status: "submitted", id: "s-9" });
  const { rerender } = render(<SubmittedView session={session} />);
  rerender(<SubmittedView session={{ ...session }} />);
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith("/sessions/s-9/result");
});

test("empty unsavedText still redirects", () => {
  render(<SubmittedView session={makeSession({ status: "submitted", id: "s-9" })} unsavedText={{}} />);
  expect(router.replace).toHaveBeenCalledTimes(1);
});

test("unsaved text stays on screen, copyable, and does not redirect", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(
    <SubmittedView
      session={makeSession({ status: "submitted", id: "s-9" })}
      unsavedText={{ 2: "my lost essay" }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/last typing was not saved/i);
  const box = screen.getByRole("textbox", { name: "Task 2 text" });
  expect(box).toHaveValue("my lost essay");
  expect(box).toHaveAttribute("readonly");
  await user.click(screen.getByRole("button", { name: "Copy Task 2 text" }));
  expect(writeText).toHaveBeenCalledWith("my lost essay");
  expect(screen.getByRole("link", { name: "View result" })).toHaveAttribute("href", "/sessions/s-9/result");
  expect(router.replace).not.toHaveBeenCalled();
});
