import { describe, expect, it } from "vitest";
import {
  hasReachedMaxAttempts,
  isRetryReady,
  retryAvailableAt,
} from "./renewal-retry-policy";

describe("renewal retry policy", () => {
  const failedAt = new Date("2026-09-06T12:00:00.000Z");

  it("does not retry before 5 minutes", () => {
    const now = new Date("2026-09-06T12:04:59.000Z");

    expect(isRetryReady(failedAt, now)).toBe(false);
  });

  it("allows retry exactly at 5 minutes", () => {
    const now = new Date("2026-09-06T12:05:00.000Z");

    expect(isRetryReady(failedAt, now)).toBe(true);
  });

  it("calculates retry availability correctly", () => {
    expect(retryAvailableAt(failedAt).toISOString()).toBe(
      "2026-09-06T12:05:00.000Z",
    );
  });

  it("allows fewer than 3 attempts", () => {
    expect(hasReachedMaxAttempts(1)).toBe(false);
    expect(hasReachedMaxAttempts(2)).toBe(false);
  });

  it("blocks after 3 attempts", () => {
    expect(hasReachedMaxAttempts(3)).toBe(true);
    expect(hasReachedMaxAttempts(4)).toBe(true);
  });
});
