import { expect, test } from "vitest";
import { clockOffset, formatRemaining, remainingMs } from "./clock";

test("remaining time is measured on the server's clock, not the client's", () => {
  const receivedAt = Date.parse("2026-10-24T10:00:00Z"); // client clock
  const serverTime = "2026-10-24T10:05:00Z"; // server is 5 min ahead
  const offset = clockOffset(serverTime, receivedAt);
  expect(offset).toBe(300_000);
  const deadline = "2026-10-24T10:15:00Z"; // server time + 10 min
  expect(remainingMs(deadline, offset, receivedAt)).toBe(600_000);
});

test("a past deadline leaves zero, never negative", () => {
  expect(remainingMs("2026-10-24T10:00:00Z", 0, Date.parse("2026-10-24T10:00:30Z"))).toBe(0);
});

test("formatRemaining rounds up to the second", () => {
  expect(formatRemaining(61_001)).toBe("01:02");
  expect(formatRemaining(59_000)).toBe("00:59");
  expect(formatRemaining(3_600_000)).toBe("1:00:00");
  expect(formatRemaining(3_725_000)).toBe("1:02:05");
  expect(formatRemaining(0)).toBe("00:00");
});
