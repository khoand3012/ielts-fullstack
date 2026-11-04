import { render } from "@testing-library/react";
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
