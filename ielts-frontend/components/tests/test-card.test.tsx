import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Skill } from "@/lib/api/types";
import { renderWithProviders } from "@/tests/render";
import { router } from "@/tests/router";
import { TestCard } from "./test-card";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function renderCard(skill: Skill) {
  renderWithProviders(
    <TestCard test={{ id: "t", skill, title: `A ${skill} test`, exam_time_limit_minutes: 60 }} />,
  );
}

test("a reading test can be started", () => {
  renderCard("reading");
  expect(screen.getByText("A reading test")).toBeInTheDocument();
  expect(screen.getByText("Exam: 60 min")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
});

test.each<Skill>(["speaking", "writing", "listening"])("a %s test shows Coming soon", (skill) => {
  renderCard(skill);
  expect(screen.getByText("Coming soon")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
});
