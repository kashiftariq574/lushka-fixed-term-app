import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";

const {
  authenticateWebhookMock,
  adminGraphqlMock,
  contractStateFindUnique,
  contractStateUpdate,
  shopConfigFindUnique,
  releaseCompleteRemainingInventoryMock,
} = vi.hoisted(() => ({
  authenticateWebhookMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
  contractStateFindUnique: vi.fn(),
  contractStateUpdate: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  releaseCompleteRemainingInventoryMock: vi.fn(),
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
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
  },
}));

vi.mock("../services/program-inventory-release.server", () => ({
  releaseCompleteRemainingInventory:
    releaseCompleteRemainingInventoryMock,
}));

import { action } from "../routes/webhooks.subscription_contracts.update";
import { COMPLETE, SERUM } from "../domain/subscription-policy";

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
    releaseCompleteRemainingInventoryMock.mockResolvedValue({
      released: 5,
      skipped: 0,
    });

    shopConfigFindUnique.mockResolvedValue({
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
      maskVariantId: "gid://shopify/ProductVariant/mask",
      oilVariantId: "gid://shopify/ProductVariant/oil",
    });
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
    } as unknown as ActionFunctionArgs);

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
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(200);
    expect(contractStateUpdate).not.toHaveBeenCalled();
  });

  it("releases Complete reserved stock before marking a cancelled contract terminal", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
      planType: COMPLETE.code,
    });

    mockShopifyContract("CANCELLED");

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(200);

    expect(shopConfigFindUnique).toHaveBeenCalledWith({
      where: {
        shop,
      },
    });

    expect(
      releaseCompleteRemainingInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId,
      variantIds: [
        "gid://shopify/ProductVariant/serum",
        "gid://shopify/ProductVariant/shampoo",
        "gid://shopify/ProductVariant/conditioner",
        "gid://shopify/ProductVariant/mask",
        "gid://shopify/ProductVariant/oil",
      ],
      reason: "contract-terminal",
    });

    expect(
      releaseCompleteRemainingInventoryMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      contractStateUpdate.mock.invocationCallOrder[0],
    );

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

  it("releases Complete reserved stock before marking an expired contract terminal", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
      planType: COMPLETE.code,
    });

    mockShopifyContract("EXPIRED", null);

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(200);

    expect(
      releaseCompleteRemainingInventoryMock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId,
        reason: "contract-terminal",
      }),
    );

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        status: "EXPIRED",
        nextBillingAt: null,
      },
    });
  });

  it("does not manually release inventory for a terminal Serum contract", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
      planType: SERUM.code,
    });

    mockShopifyContract("CANCELLED", null);

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(200);

    expect(shopConfigFindUnique).not.toHaveBeenCalled();

    expect(
      releaseCompleteRemainingInventoryMock,
    ).not.toHaveBeenCalled();

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

  it("does not mark a Complete contract terminal when reserved stock release fails", async () => {
    contractStateFindUnique.mockResolvedValue({
      contractId,
      status: "ACTIVE",
      planType: COMPLETE.code,
    });

    mockShopifyContract("CANCELLED", null);

    releaseCompleteRemainingInventoryMock.mockRejectedValue(
      new Error("Shopify inventory release failed"),
    );

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(500);

    expect(contractStateUpdate).not.toHaveBeenCalled();
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
    } as unknown as ActionFunctionArgs);

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
    } as unknown as ActionFunctionArgs);

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
    } as unknown as ActionFunctionArgs);

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
