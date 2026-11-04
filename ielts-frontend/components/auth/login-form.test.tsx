import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import { server } from "@/tests/msw/server";
import { resetRouter, router } from "@/tests/router";
import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(resetRouter);

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

test("invalid email shows a message and sends nothing", async () => {
  render(<LoginForm />);
  await fill("not-an-email", "password1");
  expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
});

test("wrong credentials show a message", async () => {
  server.use(
    http.post("*/api/auth/login", () =>
      HttpResponse.json(
        { error: { code: "unauthorized", message: "Invalid credentials", extra: {} } },
        { status: 401 },
      ),
    ),
  );
  render(<LoginForm />);
  await fill("a@b.co", "password1");
  expect(await screen.findByText("Incorrect email or password")).toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

test("success goes to the safe next path and refreshes", async () => {
  let body: unknown;
  server.use(
    http.post("*/api/auth/login", async ({ request }) => {
      body = await request.json();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  render(<LoginForm next="/sessions/abc" />);
  await fill("a@b.co", "password1");
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sessions/abc"));
  expect(router.refresh).toHaveBeenCalled();
  expect(body).toEqual({ email: "a@b.co", password: "password1" });
});

test("an unsafe next falls back to /tests", async () => {
  server.use(http.post("*/api/auth/login", () => new HttpResponse(null, { status: 204 })));
  render(<LoginForm next="//evil.com" />);
  await fill("a@b.co", "password1");
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tests"));
});
