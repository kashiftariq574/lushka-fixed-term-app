import { describe, expect, it } from "vitest";
import {
  deterministicBillingKey,
  retryBillingKey,
} from "./subscription-policy";

describe("subscription billing idempotency keys", () => {
  const contractId = "gid://shopify/SubscriptionContract/123";

  it("creates the original key for the first billing attempt", () => {
    expect(deterministicBillingKey(contractId, 1)).toBe(
      `lushka:${contractId}:cycle:1`,
    );
  });

  it("creates a fresh key for retry 1", () => {
    expect(retryBillingKey(contractId, 1, 1)).toBe(
      `lushka:${contractId}:cycle:1:retry:1`,
    );
  });

  it("creates a different key for retry 2", () => {
    const retry1 = retryBillingKey(contractId, 1, 1);
    const retry2 = retryBillingKey(contractId, 1, 2);

    expect(retry2).toBe(
      `lushka:${contractId}:cycle:1:retry:2`,
    );
    expect(retry2).not.toBe(retry1);
  });

  it("rejects invalid retry numbers", () => {
    expect(() => retryBillingKey(contractId, 1, 0)).toThrow(
      "Invalid retry attempt number",
    );
  });
});
