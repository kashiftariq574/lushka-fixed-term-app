import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contractFindMany,
  contractUpdateMany,
  shopConfigFindUnique,
  adminMock,
  releaseCompleteRemainingInventoryMock,
} = vi.hoisted(() => ({
  contractFindMany: vi.fn(),
  contractUpdateMany: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  adminMock: vi.fn(),
  releaseCompleteRemainingInventoryMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    contractState: {
      findMany: contractFindMany,
      updateMany: contractUpdateMany,
    },
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
  },
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: adminMock,
  },
}));

vi.mock("./program-inventory-release.server", () => ({
  releaseCompleteRemainingInventory:
    releaseCompleteRemainingInventoryMock,
}));

import { processExpiredPaymentHolds } from "./payment-holds.server";
import { COMPLETE, SERUM } from "../domain/subscription-policy";

const now = new Date("2026-09-08T04:00:00.000Z");

const completeContract = {
  id: "contract-state-1",
  shop: "b0z0gt-be.myshopify.com",
  contractId: "gid://shopify/SubscriptionContract/123",
  planType: COMPLETE.code,
  status: "PAYMENT_HOLD",
  paymentHoldUntil: new Date("2026-09-08T03:00:00.000Z"),
};

const serumContract = {
  ...completeContract,
  id: "contract-state-2",
  contractId: "gid://shopify/SubscriptionContract/456",
  planType: SERUM.code,
};

const completeVariantIds = [
  "gid://shopify/ProductVariant/serum",
  "gid://shopify/ProductVariant/shampoo",
  "gid://shopify/ProductVariant/conditioner",
  "gid://shopify/ProductVariant/mask",
  "gid://shopify/ProductVariant/oil",
];

describe("processExpiredPaymentHolds", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    contractFindMany.mockResolvedValue([]);
    contractUpdateMany.mockResolvedValue({ count: 1 });

    adminMock.mockResolvedValue({
      admin: {
        graphql: vi.fn(),
      },
    });

    releaseCompleteRemainingInventoryMock.mockResolvedValue({
      released: 5,
      skipped: 0,
    });

    shopConfigFindUnique.mockResolvedValue({
      serumVariantId: completeVariantIds[0],
      shampooVariantId: completeVariantIds[1],
      conditionerVariantId: completeVariantIds[2],
      maskVariantId: completeVariantIds[3],
      oilVariantId: completeVariantIds[4],
    });
  });

  it("releases Complete programme stock and expires the payment hold", async () => {
    contractFindMany.mockResolvedValue([completeContract]);

    const result = await processExpiredPaymentHolds(now);

    expect(contractFindMany).toHaveBeenCalledWith({
      where: {
        status: "PAYMENT_HOLD",
        paymentHoldUntil: {
          lte: now,
        },
      },
      orderBy: {
        paymentHoldUntil: "asc",
      },
    });

    expect(shopConfigFindUnique).toHaveBeenCalledWith({
      where: {
        shop: completeContract.shop,
      },
    });

    expect(
      releaseCompleteRemainingInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: expect.any(Function),
      contractId: completeContract.contractId,
      variantIds: completeVariantIds,
      reason: "payment-hold-expiry",
    });

    expect(contractUpdateMany).toHaveBeenCalledWith({
      where: {
        id: completeContract.id,
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

    expect(result.results[0]).toMatchObject({
      contractId: completeContract.contractId,
      expired: true,
    });
  });

  it("expires Serum hold without manual inventory release", async () => {
    contractFindMany.mockResolvedValue([serumContract]);

    const result = await processExpiredPaymentHolds(now);

    expect(
      releaseCompleteRemainingInventoryMock,
    ).not.toHaveBeenCalled();

    expect(shopConfigFindUnique).not.toHaveBeenCalled();

    expect(contractUpdateMany).toHaveBeenCalledWith({
      where: {
        id: serumContract.id,
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

    expect(result.results[0]).toMatchObject({
      contractId: serumContract.contractId,
      expired: true,
    });
  });

  it("does not expire Complete hold when required product configuration is missing", async () => {
    contractFindMany.mockResolvedValue([completeContract]);

    shopConfigFindUnique.mockResolvedValue({
      serumVariantId: completeVariantIds[0],
      shampooVariantId: completeVariantIds[1],
      conditionerVariantId: null,
      maskVariantId: completeVariantIds[3],
      oilVariantId: completeVariantIds[4],
    });

    const result = await processExpiredPaymentHolds(now);

    expect(
      releaseCompleteRemainingInventoryMock,
    ).not.toHaveBeenCalled();

    expect(contractUpdateMany).not.toHaveBeenCalled();

    expect(result.results[0]).toMatchObject({
      contractId: completeContract.contractId,
      expired: false,
      error: expect.stringContaining(
        "Complete programme inventory configuration is incomplete",
      ),
    });
  });

  it("keeps the hold intact when Shopify inventory release fails", async () => {
    contractFindMany.mockResolvedValue([completeContract]);

    releaseCompleteRemainingInventoryMock.mockRejectedValue(
      new Error("Shopify inventory release failed"),
    );

    const result = await processExpiredPaymentHolds(now);

    expect(contractUpdateMany).not.toHaveBeenCalled();

    expect(result.results[0]).toMatchObject({
      contractId: completeContract.contractId,
      expired: false,
      error: "Shopify inventory release failed",
    });
  });
});
