import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Providers } from "@/app/providers";

test("renders children inside the providers", () => {
  render(
    <Providers>
      <p>ok</p>
    </Providers>,
  );
  expect(screen.getByText("ok")).toBeInTheDocument();
});
