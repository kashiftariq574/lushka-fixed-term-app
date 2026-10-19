import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contractStateFindMany,
  contractStateUpdateMany,
  shopConfigFindUnique,
  unauthenticatedAdminMock,
  adminGraphqlMock,
  releaseCompleteRemainingInventoryMock,
  releaseSerumRemainingInventoryMock,
} = vi.hoisted(() => ({
  contractStateFindMany: vi.fn(),
  contractStateUpdateMany: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  unauthenticatedAdminMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
  releaseCompleteRemainingInventoryMock: vi.fn(),
  releaseSerumRemainingInventoryMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    contractState: {
      findMany: contractStateFindMany,
      updateMany: contractStateUpdateMany,
    },
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
  },
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: unauthenticatedAdminMock,
  },
}));

vi.mock("../services/program-inventory-release.server", () => ({
  releaseCompleteRemainingInventory:
    releaseCompleteRemainingInventoryMock,
}));

vi.mock("../services/serum-inventory-reservation.server", () => ({
  releaseSerumRemainingInventory:
    releaseSerumRemainingInventoryMock,
}));

import { ROOT_REVIVAL, SERUM } from "../domain/subscription-policy";
import { processExpiredPaymentHolds } from "../services/payment-holds.server";

describe("payment hold expiry inventory safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    unauthenticatedAdminMock.mockResolvedValue({
      admin: {
        graphql: adminGraphqlMock,
      },
    });

    shopConfigFindUnique.mockResolvedValue({
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
    });

    releaseCompleteRemainingInventoryMock.mockResolvedValue({
      released: 3,
      skipped: 0,
    });
    releaseSerumRemainingInventoryMock.mockResolvedValue({
      released: 1,
      skipped: 0,
    });

    contractStateUpdateMany.mockResolvedValue({
      count: 1,
    });
  });

  it("releases Root Revival reserved stock before expiring payment hold", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z");

    contractStateFindMany.mockResolvedValue([
      {
        id: "contract-state-1",
        shop: "b0z0gt-be.myshopify.com",
        contractId: "gid://shopify/SubscriptionContract/123",
        planType: ROOT_REVIVAL.code,
        status: "PAYMENT_HOLD",
        paymentHoldUntil: new Date("2026-09-13T11:00:00.000Z"),
      },
    ]);

    const result = await processExpiredPaymentHolds(now);

    expect(
      releaseCompleteRemainingInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId: "gid://shopify/SubscriptionContract/123",
      variantIds: [
        "gid://shopify/ProductVariant/serum",
        "gid://shopify/ProductVariant/shampoo",
        "gid://shopify/ProductVariant/conditioner",
      ],
      reason: "payment-hold-expiry",
    });

    expect(
      releaseCompleteRemainingInventoryMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      contractStateUpdateMany.mock.invocationCallOrder[0],
    );

    expect(contractStateUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-state-1",
        status: "PAYMENT_HOLD",
        paymentHoldUntil: {
          lte: now,
        },
      },
      data: {
        status: "PAYMENT_HOLD_EXPIRED",
        nextBillingAt: null,
      },
    });

    expect(result).toMatchObject({
      dueCount: 1,
      results: [
        {
          contractId: "gid://shopify/SubscriptionContract/123",
          expired: true,
        },
      ],
    });
  });

  it("releases remaining Serum reserved stock before expiring payment hold", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z");

    contractStateFindMany.mockResolvedValue([
      {
        id: "contract-state-serum",
        shop: "b0z0gt-be.myshopify.com",
        contractId: "gid://shopify/SubscriptionContract/serum",
        planType: SERUM.code,
        status: "PAYMENT_HOLD",
        paymentHoldUntil: new Date("2026-09-13T11:00:00.000Z"),
      },
    ]);

    shopConfigFindUnique.mockResolvedValue({
      serumVariantId: "gid://shopify/ProductVariant/serum",
    });

    const result = await processExpiredPaymentHolds(now);

    expect(
      releaseSerumRemainingInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId: "gid://shopify/SubscriptionContract/serum",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      reason: "payment-hold-expiry",
    });

    expect(
      releaseCompleteRemainingInventoryMock,
    ).not.toHaveBeenCalled();

    expect(result.results[0]).toMatchObject({
      contractId: "gid://shopify/SubscriptionContract/serum",
      expired: true,
    });
  });
});
