import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Countdown } from "./countdown";

test("counts down and calls onExpire exactly once", () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-24T10:00:00Z"));
  const onExpire = vi.fn();
  render(<Countdown deadline="2026-10-24T10:00:03Z" offsetMs={0} onExpire={onExpire} />);
  expect(screen.getByRole("timer")).toHaveTextContent("00:03");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("timer")).toHaveTextContent("00:02");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("timer")).toHaveTextContent("00:00");
  expect(onExpire).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(5000));
  expect(onExpire).toHaveBeenCalledTimes(1);
});

test("uses the server offset", () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-24T10:00:00Z"));
  // Server is 5 min ahead; the deadline is 2 min after the server's now.
  render(<Countdown deadline="2026-10-24T10:07:00Z" offsetMs={300_000} onExpire={() => {}} />);
  expect(screen.getByRole("timer")).toHaveTextContent("02:00");
});

test("a deadline already past on mount expires immediately, once", () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-24T10:00:00Z"));
  const onExpire = vi.fn();
  render(<Countdown deadline="2026-10-24T09:59:00Z" offsetMs={0} onExpire={onExpire} />);
  expect(onExpire).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(3000));
  expect(onExpire).toHaveBeenCalledTimes(1);
});

test("warns under five minutes and alerts under one", () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-24T10:00:00Z"));
  render(<Countdown deadline="2026-10-24T10:04:00Z" offsetMs={0} onExpire={() => {}} />);
  expect(screen.getByRole("timer")).toHaveAttribute("data-urgency", "warning");
  act(() => vi.advanceTimersByTime(3 * 60_000 + 1000));
  expect(screen.getByRole("timer")).toHaveAttribute("data-urgency", "critical");
});
