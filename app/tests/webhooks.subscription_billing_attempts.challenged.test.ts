import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  billingUpdateMany,
  contractUpdateMany,
  authenticateWebhookMock,
} = vi.hoisted(() => ({
  billingUpdateMany: vi.fn(),
  contractUpdateMany: vi.fn(),
  authenticateWebhookMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    billingAttempt: {
      updateMany: billingUpdateMany,
    },
    contractState: {
      updateMany: contractUpdateMany,
    },
  },
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
}));

import { action } from "../routes/webhooks.subscription_billing_attempts.challenged";

describe("subscription billing challenged webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    billingUpdateMany.mockResolvedValue({ count: 1 });
    contractUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("marks the billing attempt and contract as CHALLENGED", async () => {
    const billingKey = "lushka:contract-123:cycle:1";
    const contractId = "gid://shopify/SubscriptionContract/123";

    authenticateWebhookMock.mockResolvedValue({
      shop: "b0z0gt-be.myshopify.com",
      payload: {
        idempotency_key: billingKey,
        admin_graphql_api_subscription_contract_id: contractId,
      },
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(billingUpdateMany).toHaveBeenCalledWith({
      where: {
        idempotencyKey: billingKey,
        status: {
          not: "SUCCESS",
        },
      },
      data: {
        status: "CHALLENGED",
        error: "Customer payment authentication required",
      },
    });

    expect(contractUpdateMany).toHaveBeenCalledWith({
      where: {
        contractId,
        status: {
          not: "COMPLETED",
        },
      },
      data: {
        status: "CHALLENGED",
        failedAt: expect.any(Date),
      },
    });
  });

  it("ignores an invalid challenged webhook payload safely", async () => {
    authenticateWebhookMock.mockResolvedValue({
      shop: "b0z0gt-be.myshopify.com",
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
