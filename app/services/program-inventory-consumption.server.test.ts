import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  reservationFindMany,
  reservationUpdateMany,
  releaseReservedVariantUnitMock,
  reserveVariantUnitsMock,
  deductVariantInventoryMock,
} = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  reservationUpdateMany: vi.fn(),
  releaseReservedVariantUnitMock: vi.fn(),
  reserveVariantUnitsMock: vi.fn(),
  deductVariantInventoryMock: vi.fn(),
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
  releaseReservedVariantUnitForConsumption:
    releaseReservedVariantUnitMock,
  reserveVariantUnits:
    reserveVariantUnitsMock,
}));

vi.mock("./inventory.server", () => ({
  deductVariantInventory:
    deductVariantInventoryMock,
}));

import { consumeCompleteReservedInventory } from "./program-inventory-consumption.server";

const contractId =
  "gid://shopify/SubscriptionContract/123";

const locationId =
  "gid://shopify/Location/1";

const variantIds = [
  "gid://shopify/ProductVariant/serum",
  "gid://shopify/ProductVariant/shampoo",
  "gid://shopify/ProductVariant/conditioner",
  "gid://shopify/ProductVariant/mask",
  "gid://shopify/ProductVariant/oil",
];

function reservationRows(consumedQuantity = 0) {
  return variantIds.map((variantId, index) => ({
    id: `reservation-${index}`,
    contractId,
    variantId,
    inventoryItemId:
      `gid://shopify/InventoryItem/${variantId.split("/").pop()}`,
    locationId,
    reservedQuantity: 2,
    reservationAttempt: 1,
    consumptionAttempt: 1,
    consumedQuantity,
    releasedQuantity: 0,
    status:
      consumedQuantity >= 2
        ? "CONSUMED"
        : "ACTIVE",
  }));
}

describe("consumeCompleteReservedInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    reservationFindMany.mockResolvedValue(
      reservationRows(0),
    );

    reservationUpdateMany.mockResolvedValue({
      count: 5,
    });

    releaseReservedVariantUnitMock.mockResolvedValue(
      undefined,
    );

    reserveVariantUnitsMock.mockResolvedValue(
      undefined,
    );

    deductVariantInventoryMock.mockResolvedValue(
      undefined,
    );
  });

  it("consumes payment #2 from reserved programme stock", async () => {
    const graphql = vi.fn();

    const result =
      await consumeCompleteReservedInventory({
        graphql,
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      });

    expect(result).toEqual({
      consumed: 5,
      skipped: false,
    });

    expect(
      releaseReservedVariantUnitMock,
    ).toHaveBeenCalledTimes(5);

    for (const row of reservationRows(0)) {
      const variantShortId =
        row.variantId.split("/").pop();

      expect(
        releaseReservedVariantUnitMock,
      ).toHaveBeenCalledWith({
        graphql,
        inventoryItemId: row.inventoryItemId,
        locationId,
        reservedLedgerDocumentUri:
          "lushka://subscription/123/future-reservation",
        referenceDocumentUri:
          "lushka://subscription/123/cycle/1/reserved-release",
        idempotencyKey:
          `consume-release:123:${variantShortId}:cycle:1:attempt:1`,
      });
    }

    expect(
      deductVariantInventoryMock,
    ).toHaveBeenCalledWith({
      graphql,
      variantIds,
      locationId,
      idempotencyKey:
        "consume-available:123:cycle:1:attempt:1",
      referenceDocumentUri:
        "lushka://subscription/123/cycle/1/physical-consumption",
    });

    expect(
      reservationUpdateMany,
    ).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: {
          in: variantIds,
        },
      },
      data: {
        consumedQuantity: 1,
        status: "ACTIVE",
      },
    });
  });

  it("consumes payment #3 and marks reservations consumed", async () => {
    reservationFindMany.mockResolvedValue(
      reservationRows(1),
    );

    const result =
      await consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 2,
      });

    expect(result).toEqual({
      consumed: 5,
      skipped: false,
    });

    expect(
      releaseReservedVariantUnitMock,
    ).toHaveBeenCalledTimes(5);

    expect(
      deductVariantInventoryMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      reservationUpdateMany,
    ).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: {
          in: variantIds,
        },
      },
      data: {
        consumedQuantity: 2,
        status: "CONSUMED",
      },
    });
  });

  it("skips an already consumed billing cycle idempotently", async () => {
    reservationFindMany.mockResolvedValue(
      reservationRows(1),
    );

    const result =
      await consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      });

    expect(result).toEqual({
      consumed: 0,
      skipped: true,
    });

    expect(
      releaseReservedVariantUnitMock,
    ).not.toHaveBeenCalled();

    expect(
      deductVariantInventoryMock,
    ).not.toHaveBeenCalled();

    expect(
      reservationUpdateMany,
    ).not.toHaveBeenCalled();
  });

  it("refuses consumption when reservation set is incomplete", async () => {
    reservationFindMany.mockResolvedValue(
      reservationRows(0).slice(0, 4),
    );

    await expect(
      consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      }),
    ).rejects.toThrow(
      "Complete programme reservation set is incomplete",
    );

    expect(
      releaseReservedVariantUnitMock,
    ).not.toHaveBeenCalled();

    expect(
      deductVariantInventoryMock,
    ).not.toHaveBeenCalled();
  });

  it("refuses a late charge after reserved stock has been released", async () => {
    const rows = reservationRows(1);

    rows[0] = {
      ...rows[0],
      releasedQuantity: 1,
      status: "RELEASED",
    };

    reservationFindMany.mockResolvedValue(rows);

    await expect(
      consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 2,
      }),
    ).rejects.toThrow(
      "Reserved programme stock is no longer available",
    );

    expect(
      releaseReservedVariantUnitMock,
    ).not.toHaveBeenCalled();

    expect(
      deductVariantInventoryMock,
    ).not.toHaveBeenCalled();
  });

  it("re-reserves all released units if physical deduction fails", async () => {
    deductVariantInventoryMock.mockRejectedValueOnce(
      new Error("Physical inventory deduction failed"),
    );

    await expect(
      consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      }),
    ).rejects.toThrow(
      "Physical inventory deduction failed",
    );

    expect(
      releaseReservedVariantUnitMock,
    ).toHaveBeenCalledTimes(5);

    expect(
      reserveVariantUnitsMock,
    ).toHaveBeenCalledTimes(5);

    for (const variantId of variantIds) {
      const variantShortId =
        variantId.split("/").pop();

      expect(
        reserveVariantUnitsMock,
      ).toHaveBeenCalledWith({
        graphql: expect.any(Function),
        variantId,
        locationId,
        quantityToReserve: 1,
        referenceDocumentUri:
          "lushka://subscription/123/future-reservation",
        idempotencyKey:
          `consume-release-rollback:123:${variantShortId}:cycle:1:attempt:1`,
      });
    }

    expect(
      reservationUpdateMany,
    ).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: {
          in: variantIds,
        },
        consumptionAttempt: 1,
      },
      data: {
        consumptionAttempt: 2,
      },
    });
  });

  it("marks manual recovery required when reservation rollback is incomplete", async () => {
    releaseReservedVariantUnitMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error("Second reserved release failed"),
      );

    reserveVariantUnitsMock.mockRejectedValueOnce(
      new Error("Rollback reserve failed"),
    );

    await expect(
      consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      }),
    ).rejects.toThrow(
      "Programme inventory consumption failed and reservation rollback was incomplete",
    );

    expect(
      deductVariantInventoryMock,
    ).not.toHaveBeenCalled();

    expect(
      reservationUpdateMany,
    ).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: {
          in: variantIds,
        },
      },
      data: {
        status: "RECOVERY_REQUIRED",
      },
    });
  });

  it("blocks automatic consumption when manual recovery is required", async () => {
    const rows = reservationRows(0);

    rows[0] = {
      ...rows[0],
      status: "RECOVERY_REQUIRED",
    };

    reservationFindMany.mockResolvedValue(rows);

    await expect(
      consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      }),
    ).rejects.toThrow(
      "Programme inventory requires manual recovery",
    );

    expect(
      releaseReservedVariantUnitMock,
    ).not.toHaveBeenCalled();

    expect(
      deductVariantInventoryMock,
    ).not.toHaveBeenCalled();
  });

  it("does not deduct available inventory if reserved release fails", async () => {
    releaseReservedVariantUnitMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error("Reserved release failed"),
      );

    await expect(
      consumeCompleteReservedInventory({
        graphql: vi.fn(),
        contractId,
        locationId,
        variantIds,
        cycleIndex: 1,
      }),
    ).rejects.toThrow(
      "Reserved release failed",
    );

    expect(
      deductVariantInventoryMock,
    ).not.toHaveBeenCalled();

    // The first component was already released before the second
    // release failed, so it must be put back into reserved stock.
    expect(
      reserveVariantUnitsMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      reserveVariantUnitsMock,
    ).toHaveBeenCalledWith({
      graphql: expect.any(Function),
      variantId: variantIds[0],
      locationId,
      quantityToReserve: 1,
      referenceDocumentUri:
        "lushka://subscription/123/future-reservation",
      idempotencyKey:
        "consume-release-rollback:123:serum:cycle:1:attempt:1",
    });

    expect(
      reservationUpdateMany,
    ).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: {
          in: variantIds,
        },
        consumptionAttempt: 1,
      },
      data: {
        consumptionAttempt: 2,
      },
    });
  });
});
