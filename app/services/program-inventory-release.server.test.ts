import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  reservationFindMany,
  reservationUpdateMany,
  releaseReservedVariantUnitsMock,
} = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  reservationUpdateMany: vi.fn(),
  releaseReservedVariantUnitsMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    inventoryReservation: {
      findMany: reservationFindMany,
      updateMany: reservationUpdateMany,
    },
  },
}));

vi.mock("./inventory-reservations.server", () => ({
  releaseReservedVariantUnits:
    releaseReservedVariantUnitsMock,
}));

import { releaseCompleteRemainingInventory } from "./program-inventory-release.server";

const contractId =
  "gid://shopify/SubscriptionContract/123";
const locationId = "gid://shopify/Location/1";

const variantIds = [
  "gid://shopify/ProductVariant/serum",
  "gid://shopify/ProductVariant/shampoo",
  "gid://shopify/ProductVariant/conditioner",
  "gid://shopify/ProductVariant/mask",
  "gid://shopify/ProductVariant/oil",
];

function row(
  variantId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    contractId,
    variantId,
    inventoryItemId:
      `gid://shopify/InventoryItem/${variantId.split("/").pop()}`,
    locationId,
    reservedQuantity: 2,
    consumedQuantity: 0,
    releasedQuantity: 0,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("releaseCompleteRemainingInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    reservationUpdateMany.mockResolvedValue({ count: 1 });
    releaseReservedVariantUnitsMock.mockResolvedValue({});
  });

  it("releases two remaining units per component before payment #2", async () => {
    reservationFindMany.mockResolvedValue(
      variantIds.map((variantId) => row(variantId)),
    );

    const result = await releaseCompleteRemainingInventory({
      graphql: vi.fn(),
      contractId,
      variantIds,
      reason: "payment-hold-expiry",
    });

    expect(result).toEqual({
      released: 5,
      skipped: 0,
    });

    expect(
      releaseReservedVariantUnitsMock,
    ).toHaveBeenCalledTimes(5);

    for (const variantId of variantIds) {
      expect(
        releaseReservedVariantUnitsMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          inventoryItemId:
            `gid://shopify/InventoryItem/${variantId.split("/").pop()}`,
          locationId,
          quantityToRelease: 2,
          reservedLedgerDocumentUri:
            "lushka://subscription/123/future-reservation",
          referenceDocumentUri:
            "lushka://subscription/123/payment-hold-expiry",
        }),
      );
    }
  });

  it("releases only one remaining unit after payment #2 was consumed", async () => {
    reservationFindMany.mockResolvedValue(
      variantIds.map((variantId) =>
        row(variantId, {
          consumedQuantity: 1,
        }),
      ),
    );

    await releaseCompleteRemainingInventory({
      graphql: vi.fn(),
      contractId,
      variantIds,
      reason: "payment-hold-expiry",
    });

    for (const call of releaseReservedVariantUnitsMock.mock.calls) {
      expect(call[0].quantityToRelease).toBe(1);
    }
  });

  it("skips inventory that is already fully consumed", async () => {
    reservationFindMany.mockResolvedValue(
      variantIds.map((variantId) =>
        row(variantId, {
          consumedQuantity: 2,
          status: "CONSUMED",
        }),
      ),
    );

    const result = await releaseCompleteRemainingInventory({
      graphql: vi.fn(),
      contractId,
      variantIds,
      reason: "payment-hold-expiry",
    });

    expect(result).toEqual({
      released: 0,
      skipped: 5,
    });

    expect(
      releaseReservedVariantUnitsMock,
    ).not.toHaveBeenCalled();
  });

  it("skips rows already released so retries are safe", async () => {
    reservationFindMany.mockResolvedValue(
      variantIds.map((variantId) =>
        row(variantId, {
          releasedQuantity: 2,
          status: "RELEASED",
        }),
      ),
    );

    const result = await releaseCompleteRemainingInventory({
      graphql: vi.fn(),
      contractId,
      variantIds,
      reason: "payment-hold-expiry",
    });

    expect(result).toEqual({
      released: 0,
      skipped: 5,
    });

    expect(
      releaseReservedVariantUnitsMock,
    ).not.toHaveBeenCalled();
  });

  it("blocks automatic release when inventory requires manual recovery", async () => {
    reservationFindMany.mockResolvedValue([
      row(variantIds[0], {
        status: "RECOVERY_REQUIRED",
      }),
      ...variantIds.slice(1).map((variantId) =>
        row(variantId),
      ),
    ]);

    await expect(
      releaseCompleteRemainingInventory({
        graphql: vi.fn(),
        contractId,
        variantIds,
        reason: "payment-hold-expiry",
      }),
    ).rejects.toThrow(
      "Programme inventory requires manual recovery",
    );

    expect(
      releaseReservedVariantUnitsMock,
    ).not.toHaveBeenCalled();
  });

  it("rejects an incomplete reservation set", async () => {
    reservationFindMany.mockResolvedValue(
      variantIds.slice(0, 4).map((variantId) =>
        row(variantId),
      ),
    );

    await expect(
      releaseCompleteRemainingInventory({
        graphql: vi.fn(),
        contractId,
        variantIds,
        reason: "payment-hold-expiry",
      }),
    ).rejects.toThrow(
      "Incomplete programme inventory reservation set",
    );

    expect(
      releaseReservedVariantUnitsMock,
    ).not.toHaveBeenCalled();
  });
});
