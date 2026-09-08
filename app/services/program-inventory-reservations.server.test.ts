import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  reservationFindMany,
  reservationUpsert,
  reservationUpdateMany,
  getVariantInventoryStateMock,
  reserveVariantUnitsMock,
  releaseVariantUnitsMock,
} = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  reservationUpsert: vi.fn(),
  reservationUpdateMany: vi.fn(),
  getVariantInventoryStateMock: vi.fn(),
  reserveVariantUnitsMock: vi.fn(),
  releaseVariantUnitsMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    inventoryReservation: {
      findMany: reservationFindMany,
      upsert: reservationUpsert,
      updateMany: reservationUpdateMany,
    },
  },
}));

vi.mock("./inventory-reservations.server", () => ({
  getVariantInventoryState: getVariantInventoryStateMock,
  reserveVariantUnits: reserveVariantUnitsMock,
  releaseVariantUnits: releaseVariantUnitsMock,
}));

import { reserveCompleteFutureInventory } from "./program-inventory-reservations.server";

const shop = "b0z0gt-be.myshopify.com";
const contractId = "gid://shopify/SubscriptionContract/123";
const locationId = "gid://shopify/Location/1";
const planType = "COMPLETE_RECOVERY_90";

const variantIds = [
  "gid://shopify/ProductVariant/serum",
  "gid://shopify/ProductVariant/shampoo",
  "gid://shopify/ProductVariant/conditioner",
  "gid://shopify/ProductVariant/mask",
  "gid://shopify/ProductVariant/oil",
];

function stateFor(variantId: string) {
  return {
    variantId,
    inventoryItemId:
      `gid://shopify/InventoryItem/${variantId.split("/").pop()}`,
    locationId,
    available: 10,
    reserved: 0,
    onHand: 10,
  };
}

describe("reserveCompleteFutureInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    reservationFindMany.mockResolvedValue([]);
    reservationUpsert.mockResolvedValue({});
    reservationUpdateMany.mockResolvedValue({ count: 1 });

    getVariantInventoryStateMock.mockImplementation(
      async ({ variantId }: { variantId: string }) =>
        stateFor(variantId),
    );

    reserveVariantUnitsMock.mockResolvedValue({});
    releaseVariantUnitsMock.mockResolvedValue({});
  });

  it("reserves two future units for each Complete recurring component", async () => {
    const result = await reserveCompleteFutureInventory({
      graphql: vi.fn(),
      shop,
      contractId,
      planType,
      locationId,
      variantIds,
      unitsPerVariant: 2,
    });

    expect(result).toEqual({
      reserved: 5,
      skipped: 0,
    });

    expect(getVariantInventoryStateMock).toHaveBeenCalledTimes(5);
    expect(reserveVariantUnitsMock).toHaveBeenCalledTimes(5);
    expect(reservationUpsert).toHaveBeenCalledTimes(5);

    for (const variantId of variantIds) {
      expect(reserveVariantUnitsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId,
          locationId,
          quantityToReserve: 2,
        }),
      );
    }
  });

  it("skips variants that already have reservation records", async () => {
    reservationFindMany.mockResolvedValue(
      variantIds.map((variantId) => ({
        contractId,
        variantId,
        status: "ACTIVE",
        reservationAttempt: 1,
      })),
    );

    const result = await reserveCompleteFutureInventory({
      graphql: vi.fn(),
      shop,
      contractId,
      planType,
      locationId,
      variantIds,
      unitsPerVariant: 2,
    });

    expect(result).toEqual({
      reserved: 0,
      skipped: 5,
    });

    expect(getVariantInventoryStateMock).not.toHaveBeenCalled();
    expect(reserveVariantUnitsMock).not.toHaveBeenCalled();
    expect(reservationUpsert).not.toHaveBeenCalled();
  });

  it("retries a rolled-back reservation with a fresh attempt key", async () => {
    const rolledBackVariant = variantIds[0];

    reservationFindMany.mockResolvedValue([
      {
        contractId,
        variantId: rolledBackVariant,
        status: "ROLLED_BACK",
        reservationAttempt: 1,
      },
    ]);

    const result = await reserveCompleteFutureInventory({
      graphql: vi.fn(),
      shop,
      contractId,
      planType,
      locationId,
      variantIds: [rolledBackVariant],
      unitsPerVariant: 2,
    });

    expect(result).toEqual({
      reserved: 1,
      skipped: 0,
    });

    expect(reserveVariantUnitsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: rolledBackVariant,
        quantityToReserve: 2,
        idempotencyKey: "reserve:123:serum:attempt:2",
      }),
    );

    expect(reservationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          reservationAttempt: 2,
          status: "ACTIVE",
        }),
      }),
    );
  });

  it("preflights all stock and reserves nothing when one component is insufficient", async () => {
    getVariantInventoryStateMock.mockImplementation(
      async ({ variantId }: { variantId: string }) => {
        const state = stateFor(variantId);

        if (variantId.includes("mask")) {
          return {
            ...state,
            available: 1,
            onHand: 1,
          };
        }

        return state;
      },
    );

    await expect(
      reserveCompleteFutureInventory({
        graphql: vi.fn(),
        shop,
        contractId,
        planType,
        locationId,
        variantIds,
        unitsPerVariant: 2,
      }),
    ).rejects.toThrow(
      "Insufficient future programme inventory",
    );

    expect(reserveVariantUnitsMock).not.toHaveBeenCalled();
    expect(reservationUpsert).not.toHaveBeenCalled();
  });

  it("rolls back earlier reservations if a later component reservation fails", async () => {
    reserveVariantUnitsMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Error("Shopify reservation move failed"),
      );

    await expect(
      reserveCompleteFutureInventory({
        graphql: vi.fn(),
        shop,
        contractId,
        planType,
        locationId,
        variantIds,
        unitsPerVariant: 2,
      }),
    ).rejects.toThrow("Shopify reservation move failed");

    expect(releaseVariantUnitsMock).toHaveBeenCalledTimes(1);

    expect(releaseVariantUnitsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variantId: variantIds[0],
        locationId,
        quantityToRelease: 2,
      }),
    );
  });

  it("does not re-reserve a consumed programme reservation", async () => {
    const variantId = variantIds[0];

    reservationFindMany.mockResolvedValue([
      {
        contractId,
        variantId,
        status: "CONSUMED",
        reservationAttempt: 1,
      },
    ]);

    const result = await reserveCompleteFutureInventory({
      graphql: vi.fn(),
      shop,
      contractId,
      planType,
      locationId,
      variantIds: [variantId],
      unitsPerVariant: 2,
    });

    expect(result).toEqual({
      reserved: 0,
      skipped: 1,
    });

    expect(getVariantInventoryStateMock).not.toHaveBeenCalled();
    expect(reserveVariantUnitsMock).not.toHaveBeenCalled();
    expect(reservationUpsert).not.toHaveBeenCalled();
  });

  it("blocks automatic reservation when manual recovery is required", async () => {
    const variantId = variantIds[0];

    reservationFindMany.mockResolvedValue([
      {
        contractId,
        variantId,
        status: "RECOVERY_REQUIRED",
        reservationAttempt: 1,
      },
    ]);

    await expect(
      reserveCompleteFutureInventory({
        graphql: vi.fn(),
        shop,
        contractId,
        planType,
        locationId,
        variantIds: [variantId],
        unitsPerVariant: 2,
      }),
    ).rejects.toThrow(
      "Programme inventory requires manual recovery",
    );

    expect(getVariantInventoryStateMock).not.toHaveBeenCalled();
    expect(reserveVariantUnitsMock).not.toHaveBeenCalled();
    expect(reservationUpsert).not.toHaveBeenCalled();
  });

  it("does not automatically re-reserve released programme inventory", async () => {
    const variantId = variantIds[0];

    reservationFindMany.mockResolvedValue([
      {
        contractId,
        variantId,
        status: "RELEASED",
        reservationAttempt: 1,
      },
    ]);

    await expect(
      reserveCompleteFutureInventory({
        graphql: vi.fn(),
        shop,
        contractId,
        planType,
        locationId,
        variantIds: [variantId],
        unitsPerVariant: 2,
      }),
    ).rejects.toThrow(
      "Programme inventory reservation has been released",
    );

    expect(getVariantInventoryStateMock).not.toHaveBeenCalled();
    expect(reserveVariantUnitsMock).not.toHaveBeenCalled();
    expect(reservationUpsert).not.toHaveBeenCalled();
  });

});
