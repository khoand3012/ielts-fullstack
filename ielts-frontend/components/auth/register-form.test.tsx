import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import { server } from "@/tests/msw/server";
import { resetRouter, router } from "@/tests/router";
import { RegisterForm } from "./register-form";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  // Paste rather than type: typing 129 characters one by one is slow.
  await user.click(screen.getByLabelText("Password"));
  await user.paste(password);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

test("password shorter than 8 characters is rejected", async () => {
  render(<RegisterForm />);
  await fill("a@b.co", "1234567");
  expect(await screen.findByText("At least 8 characters")).toBeInTheDocument();
});

test("password longer than 128 characters is rejected", async () => {
  render(<RegisterForm />);
  await fill("a@b.co", "x".repeat(129));
  expect(await screen.findByText("At most 128 characters")).toBeInTheDocument();
});

test("backend error message is shown", async () => {
  server.use(
    http.post("*/api/auth/register", () =>
      HttpResponse.json(
        { error: { code: "conflict", message: "Email already registered", extra: {} } },
        { status: 409 },
      ),
    ),
  );
  render(<RegisterForm />);
  await fill("a@b.co", "password1");
  expect(await screen.findByText("Email already registered")).toBeInTheDocument();
});

test("FastAPI validation errors are shown too", async () => {
  server.use(
    http.post("*/api/auth/register", () =>
      HttpResponse.json(
        { detail: [{ loc: ["body", "email"], msg: "value is not a valid email address", type: "x" }] },
        { status: 422 },
      ),
    ),
  );
  render(<RegisterForm />);
  await fill("a@b.co", "password1");
  expect(await screen.findByText("value is not a valid email address")).toBeInTheDocument();
});

test("success goes to /tests", async () => {
  server.use(http.post("*/api/auth/register", () => new HttpResponse(null, { status: 204 })));
  render(<RegisterForm />);
  await fill("a@b.co", "password1");
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tests"));
  expect(router.refresh).toHaveBeenCalled();
});
