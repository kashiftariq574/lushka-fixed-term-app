import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateWebhookMock,
  adminGraphqlMock,
  contractStateFindUnique,
  contractStateUpdate,
} = vi.hoisted(() => ({
  authenticateWebhookMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
  contractStateFindUnique: vi.fn(),
  contractStateUpdate: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
}));

vi.mock("../db.server", () => ({
  default: {
    contractState: {
      findUnique: contractStateFindUnique,
      update: contractStateUpdate,
    },
  },
}));

import { action } from "../routes/webhooks.subscription_contracts.update";

const shop = "b0z0gt-be.myshopify.com";
const contractId = "gid://shopify/SubscriptionContract/123";

function mockWebhook() {
  authenticateWebhookMock.mockResolvedValue({
    admin: {
      graphql: adminGraphqlMock,
    },
    payload: {
      admin_graphql_api_id: contractId,
    },
    shop,
    topic: "SUBSCRIPTION_CONTRACTS_UPDATE",
  });
}

function mockShopifyContract(
  status: string,
  nextBillingDate: string | null = "2026-10-07T00:00:00.000Z",
) {
  adminGraphqlMock.mockResolvedValue({
    json: async () => ({
      data: {
        subscriptionContract: {
          id: contractId,
          status,
          nextBillingDate,
        },
      },
    }),
  });
}

describe("subscription contract update webhook safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhook();
    contractStateUpdate.mockResolvedValue({});
  });

  it("never revives a locally completed fixed-term contract", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "COMPLETED",
    });

    mockShopifyContract("ACTIVE");

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(adminGraphqlMock).not.toHaveBeenCalled();
    expect(contractStateUpdate).not.toHaveBeenCalled();
  });

  it("does not overwrite CHALLENGED with a generic Shopify ACTIVE update", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "CHALLENGED",
    });

    mockShopifyContract("ACTIVE");

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(contractStateUpdate).not.toHaveBeenCalled();
  });

  it("marks a cancelled Shopify contract terminal and clears billing", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
    });

    mockShopifyContract("CANCELLED");

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        status: "CANCELLED",
        nextBillingAt: null,
      },
    });
  });

  it("pauses local renewals when Shopify contract is PAUSED", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
    });

    mockShopifyContract("PAUSED");

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        status: "PAUSED",
        nextBillingAt: new Date("2026-10-07T00:00:00.000Z"),
      },
    });
  });

  it("stops local renewals when Shopify contract is FAILED", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
    });

    mockShopifyContract("FAILED", null);

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        status: "FAILED",
        nextBillingAt: null,
        failedAt: expect.any(Date),
      },
    });
  });

  it("reactivates a previously paused contract when Shopify becomes ACTIVE", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "PAUSED",
    });

    mockShopifyContract("ACTIVE");

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        status: "ACTIVE",
        nextBillingAt: new Date("2026-10-07T00:00:00.000Z"),
        failedAt: null,
      },
    });
  });
});
