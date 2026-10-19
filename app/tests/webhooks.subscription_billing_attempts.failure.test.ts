import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  billingFindUnique,
  billingUpdateMany,
  contractFindUnique,
  contractUpdateMany,
  shopConfigFindUnique,
  inventoryUpdateMany,
  authenticateWebhookMock,
  adminGraphqlMock,
  restoreSerumMock,
} = vi.hoisted(() => ({
  billingFindUnique: vi.fn(),
  billingUpdateMany: vi.fn(),
  contractFindUnique: vi.fn(),
  contractUpdateMany: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  inventoryUpdateMany: vi.fn(),
  authenticateWebhookMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
  restoreSerumMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    billingAttempt: {
      findUnique: billingFindUnique,
      updateMany: billingUpdateMany,
    },
    contractState: {
      findUnique: contractFindUnique,
      updateMany: contractUpdateMany,
    },
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
    inventoryReservation: {
      updateMany: inventoryUpdateMany,
    },
  },
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
}));

vi.mock("../services/serum-inventory-reservation.server", () => ({
  restoreSerumReservedInventoryAfterFailedBilling: restoreSerumMock,
}));

import { SERUM } from "../domain/subscription-policy";
import { action } from "../routes/webhooks.subscription_billing_attempts.failure";

const shop = "b0z0gt-be.myshopify.com";
const contractId = "gid://shopify/SubscriptionContract/123";
const billingKey = `lushka:${contractId}:cycle:1`;
const serumVariantId = "gid://shopify/ProductVariant/serum";

describe("subscription billing failure webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    billingUpdateMany.mockResolvedValue({ count: 1 });
    contractUpdateMany.mockResolvedValue({ count: 1 });
    restoreSerumMock.mockResolvedValue({ restored: 1, skipped: false });
  });

  it("marks the billing attempt FAILED and returns the contract to ACTIVE", async () => {
    billingFindUnique.mockResolvedValue({
      idempotencyKey: billingKey,
      status: "PENDING",
      cycleIndex: 1,
    });
    contractFindUnique.mockResolvedValue({
      contractId,
      planType: "COMPLETE_RECOVERY_90",
    });

    authenticateWebhookMock.mockResolvedValue({
      shop,
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {
        idempotency_key: billingKey,
        admin_graphql_api_subscription_contract_id: contractId,
        error_code: "PAYMENT_FAILED",
        error_message: "Card declined",
      },
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(restoreSerumMock).not.toHaveBeenCalled();

    expect(billingUpdateMany).toHaveBeenCalledWith({
      where: {
        idempotencyKey: billingKey,
        status: {
          not: "SUCCESS",
        },
      },
      data: {
        status: "FAILED",
        error: "PAYMENT_FAILED: Card declined",
      },
    });

    expect(contractUpdateMany).toHaveBeenCalledWith({
      where: {
        contractId,
        status: {
          in: ["ACTIVE", "CHALLENGED"],
        },
      },
      data: {
        status: "ACTIVE",
        failedAt: expect.any(Date),
      },
    });
  });

  it("restores released Serum inventory on definitive failure", async () => {
    billingFindUnique.mockResolvedValue({
      idempotencyKey: billingKey,
      status: "SUBMITTED",
      cycleIndex: 1,
    });
    contractFindUnique.mockResolvedValue({
      contractId,
      planType: SERUM.code,
    });
    shopConfigFindUnique.mockResolvedValue({
      serumVariantId,
    });

    authenticateWebhookMock.mockResolvedValue({
      shop,
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {
        idempotency_key: billingKey,
        admin_graphql_api_subscription_contract_id: contractId,
        error_code: "PAYMENT_FAILED",
        error_message: "Card declined",
      },
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(restoreSerumMock).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId,
      serumVariantId,
      cycleIndex: 1,
    });
    expect(billingUpdateMany).toHaveBeenCalled();
  });

  it("does not restore Serum inventory twice on duplicate failure", async () => {
    billingFindUnique.mockResolvedValue({
      idempotencyKey: billingKey,
      status: "FAILED",
      cycleIndex: 1,
    });
    contractFindUnique.mockResolvedValue({
      contractId,
      planType: SERUM.code,
    });

    authenticateWebhookMock.mockResolvedValue({
      shop,
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {
        idempotency_key: billingKey,
        admin_graphql_api_subscription_contract_id: contractId,
        error_code: "PAYMENT_FAILED",
        error_message: "Card declined",
      },
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(restoreSerumMock).not.toHaveBeenCalled();
    expect(billingUpdateMany).not.toHaveBeenCalled();
  });

  it("ignores an invalid failure webhook payload safely", async () => {
    authenticateWebhookMock.mockResolvedValue({
      shop,
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {},
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(billingUpdateMany).not.toHaveBeenCalled();
    expect(contractUpdateMany).not.toHaveBeenCalled();
  });
});
