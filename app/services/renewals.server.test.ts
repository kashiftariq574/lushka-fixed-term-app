import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contractFindMany,
  billingFindMany,
  billingCreate,
  billingUpdateMany,
  contractUpdate,
  contractUpdateMany,
  shopConfigFindUnique,
  adminMock,
  createBillingAttemptMock,
  prepareSerumMock,
  restoreSerumMock,
} = vi.hoisted(() => ({
  contractFindMany: vi.fn(),
  billingFindMany: vi.fn(),
  billingCreate: vi.fn(),
  billingUpdateMany: vi.fn(),
  contractUpdate: vi.fn(),
  contractUpdateMany: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  adminMock: vi.fn(),
  createBillingAttemptMock: vi.fn(),
  prepareSerumMock: vi.fn(),
  restoreSerumMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    contractState: {
      findMany: contractFindMany,
      update: contractUpdate,
      updateMany: contractUpdateMany,
    },
    billingAttempt: {
      findMany: billingFindMany,
      create: billingCreate,
      updateMany: billingUpdateMany,
    },
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
    inventoryReservation: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: adminMock,
  },
}));

vi.mock("./billing.server", async () => {
  const actual = await vi.importActual<
    typeof import("./billing.server")
  >("./billing.server");

  return {
    ...actual,
    createBillingAttempt: createBillingAttemptMock,
  };
});

vi.mock("./serum-inventory-reservation.server", () => ({
  prepareSerumReservedInventoryForBilling: prepareSerumMock,
  restoreSerumReservedInventoryAfterFailedBilling: restoreSerumMock,
}));

import {
  BillingAttemptDefinitiveError,
  BillingAttemptUncertainError,
} from "./billing.server";
import { SERUM } from "../domain/subscription-policy";
import { processDueRenewals } from "./renewals.server";

const now = new Date("2026-09-06T12:10:00.000Z");

const contract = {
  id: "state-1",
  shop: "b0z0gt-be.myshopify.com",
  contractId: "gid://shopify/SubscriptionContract/123",
  planType: "COMPLETE_RECOVERY_90",
  successfulCycleCount: 1,
  nextBillingAt: new Date("2026-09-06T12:00:00.000Z"),
};

function attempt(status: string, updatedAt = new Date("2026-09-06T12:00:00.000Z")) {
  return {
    id: `attempt-${status}`,
    contractStateId: contract.id,
    contractId: contract.contractId,
    cycleIndex: 1,
    idempotencyKey: `key-${status}`,
    status,
    attemptCount: 1,
    error: null,
    shopifyBillingAttemptId: null,
    shopifyOrderId: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("processDueRenewals safety skips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contractFindMany.mockResolvedValue([contract]);
  });

  it("skips when the cycle already has a SUCCESS attempt", async () => {
    billingFindMany.mockResolvedValue([attempt("SUCCESS")]);

    const result = await processDueRenewals(now);

    expect(result.results[0]).toMatchObject({
      skipped: true,
      reason: "Billing attempt already succeeded",
    });
    expect(billingCreate).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "SUBMITTED", "CHALLENGED"])(
    "skips when latest attempt status is %s",
    async (status) => {
      billingFindMany.mockResolvedValue([attempt(status)]);

      const result = await processDueRenewals(now);

      expect(result.results[0]).toMatchObject({
        skipped: true,
        reason: `Existing billing attempt status: ${status}`,
      });
      expect(billingCreate).not.toHaveBeenCalled();
      expect(createBillingAttemptMock).not.toHaveBeenCalled();
    },
  );

  it("waits when FAILED attempt is less than 5 minutes old", async () => {
    billingFindMany.mockResolvedValue([
      attempt("FAILED", new Date("2026-09-06T12:05:01.000Z")),
    ]);

    const result = await processDueRenewals(now);

    expect(result.results[0]).toMatchObject({
      skipped: true,
      reason: "Waiting 5 minutes before retrying failed payment",
    });
    expect(billingCreate).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("moves the contract into a 72-hour payment hold after 3 failed attempts", async () => {
    billingFindMany.mockResolvedValue([
      { ...attempt("FAILED"), id: "attempt-3", attemptCount: 3 },
      { ...attempt("FAILED"), id: "attempt-2", attemptCount: 2 },
      { ...attempt("FAILED"), id: "attempt-1", attemptCount: 1 },
    ]);

    contractUpdateMany.mockResolvedValue({ count: 1 });

    const result = await processDueRenewals(now);

    const paymentHoldUntil = new Date(
      now.getTime() + 72 * 60 * 60 * 1000,
    );

    expect(contractUpdateMany).toHaveBeenCalledWith({
      where: {
        id: contract.id,
        status: "ACTIVE",
      },
      data: {
        status: "PAYMENT_HOLD",
        paymentHoldStartedAt: now,
        paymentHoldUntil,
      },
    });

    expect(result.results[0]).toMatchObject({
      skipped: true,
      reason: "Payment moved to 72-hour hold after maximum attempts",
    });

    expect(billingCreate).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });
});

describe("processDueRenewals retry creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contractFindMany.mockResolvedValue([contract]);
  });

  it("creates retry:1 after a failed attempt becomes eligible", async () => {
    billingFindMany.mockResolvedValue([
      {
        ...attempt(
          "FAILED",
          new Date("2026-09-06T12:04:00.000Z"),
        ),
        id: "attempt-1",
        attemptCount: 1,
        idempotencyKey: `lushka:${contract.contractId}:cycle:1`,
      },
    ]);

    billingCreate.mockResolvedValue({
      id: "attempt-2",
      contractStateId: contract.id,
      contractId: contract.contractId,
      cycleIndex: 1,
      idempotencyKey:
        `lushka:${contract.contractId}:cycle:1:retry:1`,
      status: "PENDING",
      attemptCount: 2,
    });

    adminMock.mockResolvedValue({
      admin: {
        graphql: vi.fn(),
      },
    });

    createBillingAttemptMock.mockResolvedValue({
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/456",
        ready: false,
        order: null,
        errorMessage: null,
      },
    });

    billingUpdateMany.mockResolvedValue({ count: 1 });

    const result = await processDueRenewals(now);

    const expectedKey =
      `lushka:${contract.contractId}:cycle:1:retry:1`;

    expect(billingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: contract.contractId,
        cycleIndex: 1,
        attemptCount: 2,
        idempotencyKey: expectedKey,
      }),
    });

    expect(createBillingAttemptMock).toHaveBeenCalledWith(
      expect.anything(),
      contract.contractId,
      1,
      expectedKey,
    );

    expect(result.results[0]).toMatchObject({
      submitted: true,
    });
  });
});

describe("processDueRenewals second retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contractFindMany.mockResolvedValue([contract]);
  });

  it("creates retry:2 after two failed attempts", async () => {
    billingFindMany.mockResolvedValue([
      {
        ...attempt(
          "FAILED",
          new Date("2026-09-06T12:04:00.000Z"),
        ),
        id: "attempt-2",
        attemptCount: 2,
        idempotencyKey:
          `lushka:${contract.contractId}:cycle:1:retry:1`,
      },
      {
        ...attempt(
          "FAILED",
          new Date("2026-09-06T12:00:00.000Z"),
        ),
        id: "attempt-1",
        attemptCount: 1,
        idempotencyKey:
          `lushka:${contract.contractId}:cycle:1`,
      },
    ]);

    billingCreate.mockResolvedValue({
      id: "attempt-3",
      contractStateId: contract.id,
      contractId: contract.contractId,
      cycleIndex: 1,
      idempotencyKey:
        `lushka:${contract.contractId}:cycle:1:retry:2`,
      status: "PENDING",
      attemptCount: 3,
    });

    adminMock.mockResolvedValue({
      admin: {
        graphql: vi.fn(),
      },
    });

    createBillingAttemptMock.mockResolvedValue({
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/789",
        ready: false,
        order: null,
        errorMessage: null,
      },
    });

    billingUpdateMany.mockResolvedValue({ count: 1 });

    await processDueRenewals(now);

    const expectedKey =
      `lushka:${contract.contractId}:cycle:1:retry:2`;

    expect(billingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptCount: 3,
        idempotencyKey: expectedKey,
      }),
    });

    expect(createBillingAttemptMock).toHaveBeenCalledWith(
      expect.anything(),
      contract.contractId,
      1,
      expectedKey,
    );
  });
});

describe("processDueRenewals Serum inventory release", () => {
  const serumContract = {
    ...contract,
    id: "state-serum",
    contractId: "gid://shopify/SubscriptionContract/serum",
    planType: SERUM.code,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    contractFindMany.mockResolvedValue([serumContract]);
    shopConfigFindUnique.mockResolvedValue({
      serumVariantId: "gid://shopify/ProductVariant/serum",
    });
    prepareSerumMock.mockResolvedValue({
      released: 1,
      skipped: false,
      consumptionAttempt: 1,
    });
    restoreSerumMock.mockResolvedValue({
      restored: 1,
      skipped: false,
    });
  });

  it("releases one reserved Serum unit before createBillingAttempt", async () => {
    billingFindMany.mockResolvedValue([]);

    billingCreate.mockResolvedValue({
      id: "attempt-serum-1",
      contractStateId: serumContract.id,
      contractId: serumContract.contractId,
      cycleIndex: 1,
      idempotencyKey: `lushka:${serumContract.contractId}:cycle:1`,
      status: "PREPARING",
      attemptCount: 1,
    });

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    createBillingAttemptMock.mockResolvedValue({
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/serum",
        ready: true,
        order: null,
        errorMessage: null,
      },
    });

    billingUpdateMany.mockResolvedValue({ count: 1 });

    const result = await processDueRenewals(now);

    expect(billingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "PREPARING",
        contractId: serumContract.contractId,
      }),
    });

    expect(prepareSerumMock).toHaveBeenCalledWith({
      graphql,
      contractId: serumContract.contractId,
      serumVariantId: "gid://shopify/ProductVariant/serum",
      cycleIndex: 1,
    });

    expect(prepareSerumMock.mock.invocationCallOrder[0]).toBeLessThan(
      createBillingAttemptMock.mock.invocationCallOrder[0],
    );

    expect(billingUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "attempt-serum-1",
        status: "PREPARING",
      },
      data: {
        status: "INVENTORY_RELEASED",
      },
    });

    expect(result.results[0]).toMatchObject({
      submitted: true,
    });
  });

  it("restores Serum inventory on definitive billing rejection after release", async () => {
    billingFindMany.mockResolvedValue([]);

    billingCreate.mockResolvedValue({
      id: "attempt-serum-1",
      contractStateId: serumContract.id,
      contractId: serumContract.contractId,
      cycleIndex: 1,
      idempotencyKey: `lushka:${serumContract.contractId}:cycle:1`,
      status: "PREPARING",
      attemptCount: 1,
    });

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    billingUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    createBillingAttemptMock.mockRejectedValue(
      new BillingAttemptDefinitiveError(
        "Billing attempt rejected: [{\"message\":\"Card declined\"}]",
      ),
    );

    const result = await processDueRenewals(now);

    expect(restoreSerumMock).toHaveBeenCalledWith({
      graphql,
      contractId: serumContract.contractId,
      serumVariantId: "gid://shopify/ProductVariant/serum",
      cycleIndex: 1,
    });

    expect(result.results[0]).toMatchObject({
      submitted: false,
      error: expect.stringContaining("Billing attempt rejected"),
    });
  });

  it("restores Serum inventory when billing-cycle lookup fails before mutation", async () => {
    billingFindMany.mockResolvedValue([]);

    billingCreate.mockResolvedValue({
      id: "attempt-serum-1",
      contractStateId: serumContract.id,
      contractId: serumContract.contractId,
      cycleIndex: 1,
      idempotencyKey: `lushka:${serumContract.contractId}:cycle:1`,
      status: "PREPARING",
      attemptCount: 1,
    });

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    billingUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    createBillingAttemptMock.mockRejectedValue(
      new BillingAttemptDefinitiveError(
        "Billing cycle lookup failed before billing mutation submit",
      ),
    );

    const result = await processDueRenewals(now);

    expect(restoreSerumMock).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({
      submitted: false,
    });
  });

  it("does not restore Serum on mutation transport timeout after submission", async () => {
    billingFindMany.mockResolvedValue([]);

    billingCreate.mockResolvedValue({
      id: "attempt-serum-1",
      contractStateId: serumContract.id,
      contractId: serumContract.contractId,
      cycleIndex: 1,
      idempotencyKey: `lushka:${serumContract.contractId}:cycle:1`,
      status: "PREPARING",
      attemptCount: 1,
    });

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    billingUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    createBillingAttemptMock.mockRejectedValue(
      new BillingAttemptUncertainError(
        "Billing mutation transport failed after submission may have occurred",
      ),
    );

    const result = await processDueRenewals(now);

    expect(restoreSerumMock).not.toHaveBeenCalled();
    expect(billingUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "attempt-serum-1",
        status: {
          in: ["INVENTORY_RELEASED", "PREPARING"],
        },
      },
      data: {
        status: "INVENTORY_RELEASED",
        error: expect.stringContaining("transport failed"),
      },
    });
    expect(result.results[0]).toMatchObject({
      submitted: false,
      uncertain: true,
    });
  });

  it("does not restore Serum on uncertain response parsing failure", async () => {
    billingFindMany.mockResolvedValue([
      {
        id: "attempt-serum-1",
        contractStateId: serumContract.id,
        contractId: serumContract.contractId,
        cycleIndex: 1,
        idempotencyKey: `lushka:${serumContract.contractId}:cycle:1`,
        status: "INVENTORY_RELEASED",
        attemptCount: 1,
        error: null,
        shopifyBillingAttemptId: null,
        shopifyOrderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    billingUpdateMany.mockResolvedValue({ count: 1 });

    createBillingAttemptMock.mockRejectedValue(
      new BillingAttemptUncertainError(
        "Billing mutation response parsing failed after submission may have occurred",
      ),
    );

    const result = await processDueRenewals(now);

    expect(billingCreate).not.toHaveBeenCalled();
    expect(prepareSerumMock).not.toHaveBeenCalled();
    expect(restoreSerumMock).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      uncertain: true,
    });
  });

  it("retries uncertain Serum failure with the same BillingAttempt and without a second release", async () => {
    const idempotencyKey = `lushka:${serumContract.contractId}:cycle:1`;

    billingFindMany.mockResolvedValue([
      {
        id: "attempt-serum-1",
        contractStateId: serumContract.id,
        contractId: serumContract.contractId,
        cycleIndex: 1,
        idempotencyKey,
        status: "INVENTORY_RELEASED",
        attemptCount: 1,
        error: "Billing mutation transport failed after submission may have occurred",
        shopifyBillingAttemptId: null,
        shopifyOrderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    createBillingAttemptMock.mockResolvedValue({
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/serum",
        ready: true,
        order: { id: "gid://shopify/Order/999" },
        errorMessage: null,
      },
    });

    billingUpdateMany.mockResolvedValue({ count: 1 });

    const result = await processDueRenewals(now);

    expect(billingCreate).not.toHaveBeenCalled();
    expect(prepareSerumMock).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).toHaveBeenCalledWith(
      graphql,
      serumContract.contractId,
      1,
      idempotencyKey,
    );
    expect(result.results[0]).toMatchObject({
      submitted: true,
      billingAttemptId:
        "gid://shopify/SubscriptionBillingAttempt/serum",
    });
  });

  it("does not release Serum twice when resuming INVENTORY_RELEASED", async () => {
    billingFindMany.mockResolvedValue([
      {
        id: "attempt-serum-1",
        contractStateId: serumContract.id,
        contractId: serumContract.contractId,
        cycleIndex: 1,
        idempotencyKey: `lushka:${serumContract.contractId}:cycle:1`,
        status: "INVENTORY_RELEASED",
        attemptCount: 1,
        error: null,
        shopifyBillingAttemptId: null,
        shopifyOrderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const graphql = vi.fn();
    adminMock.mockResolvedValue({
      admin: { graphql },
    });

    createBillingAttemptMock.mockResolvedValue({
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/serum",
        ready: false,
        order: null,
        errorMessage: null,
      },
    });

    billingUpdateMany.mockResolvedValue({ count: 1 });

    await processDueRenewals(now);

    expect(billingCreate).not.toHaveBeenCalled();
    expect(prepareSerumMock).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).toHaveBeenCalled();
  });
});
