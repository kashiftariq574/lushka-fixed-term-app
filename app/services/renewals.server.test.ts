import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contractFindMany,
  billingFindMany,
  billingCreate,
  billingUpdateMany,
  contractUpdate,
  adminMock,
  createBillingAttemptMock,
} = vi.hoisted(() => ({
  contractFindMany: vi.fn(),
  billingFindMany: vi.fn(),
  billingCreate: vi.fn(),
  billingUpdateMany: vi.fn(),
  contractUpdate: vi.fn(),
  adminMock: vi.fn(),
  createBillingAttemptMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    contractState: {
      findMany: contractFindMany,
      update: contractUpdate,
    },
    billingAttempt: {
      findMany: billingFindMany,
      create: billingCreate,
      updateMany: billingUpdateMany,
    },
  },
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: adminMock,
  },
}));

vi.mock("./billing.server", () => ({
  createBillingAttempt: createBillingAttemptMock,
}));

import { processDueRenewals } from "./renewals.server";

const now = new Date("2026-09-06T12:10:00.000Z");

const contract = {
  id: "state-1",
  shop: "b0z0gt-be.myshopify.com",
  contractId: "gid://shopify/SubscriptionContract/123",
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

  it("waits when FAILED attempt is less than 2 minutes old", async () => {
    billingFindMany.mockResolvedValue([
      attempt("FAILED", new Date("2026-09-06T12:08:01.000Z")),
    ]);

    const result = await processDueRenewals(now);

    expect(result.results[0]).toMatchObject({
      skipped: true,
      reason: "Waiting 2 minutes before retrying failed payment",
    });
    expect(billingCreate).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("stops after 3 failed attempts for the same cycle", async () => {
    billingFindMany.mockResolvedValue([
      { ...attempt("FAILED"), id: "attempt-3", attemptCount: 3 },
      { ...attempt("FAILED"), id: "attempt-2", attemptCount: 2 },
      { ...attempt("FAILED"), id: "attempt-1", attemptCount: 1 },
    ]);

    const result = await processDueRenewals(now);

    expect(result.results[0]).toMatchObject({
      skipped: true,
      reason: "Maximum billing attempts reached for this cycle",
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
          new Date("2026-09-06T12:07:00.000Z"),
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
          new Date("2026-09-06T12:07:00.000Z"),
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
