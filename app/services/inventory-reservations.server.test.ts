import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getVariantInventoryState,
  releaseReservedVariantUnitForConsumption,
  releaseVariantUnits,
  reserveVariantUnits,
} from "./inventory-reservations.server";

const variantId = "gid://shopify/ProductVariant/123";
const inventoryItemId = "gid://shopify/InventoryItem/456";
const locationId = "gid://shopify/Location/789";
const referenceDocumentUri =
  "gid://lushka/SubscriptionContract/contract-123";

function response(body: unknown): Response {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function inventoryResponse({
  available = 8,
  reserved = 1,
  onHand = 9,
  tracked = true,
}: {
  available?: number;
  reserved?: number;
  onHand?: number;
  tracked?: boolean;
} = {}) {
  return response({
    data: {
      node: {
        id: variantId,
        inventoryItem: {
          id: inventoryItemId,
          tracked,
          inventoryLevel: {
            quantities: [
              { name: "available", quantity: available },
              { name: "reserved", quantity: reserved },
              { name: "on_hand", quantity: onHand },
            ],
          },
        },
      },
    },
  });
}

function moveSuccessResponse() {
  return response({
    data: {
      inventoryMoveQuantities: {
        inventoryAdjustmentGroup: {
          id: "gid://shopify/InventoryAdjustmentGroup/1",
          reason: "reservation_created",
          referenceDocumentUri,
          changes: [],
        },
        userErrors: [],
      },
    },
  });
}

describe("inventory reservation state", () => {
  const graphql = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads available, reserved and on-hand inventory", async () => {
    graphql.mockResolvedValue(
      inventoryResponse({
        available: 8,
        reserved: 2,
        onHand: 10,
      }),
    );

    const result = await getVariantInventoryState({
      graphql,
      variantId,
      locationId,
    });

    expect(result).toEqual({
      variantId,
      inventoryItemId,
      locationId,
      available: 8,
      reserved: 2,
      onHand: 10,
    });

    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("rejects variants whose inventory is not tracked", async () => {
    graphql.mockResolvedValue(
      inventoryResponse({
        tracked: false,
      }),
    );

    await expect(
      getVariantInventoryState({
        graphql,
        variantId,
        locationId,
      }),
    ).rejects.toThrow(
      `Inventory is not tracked for variant ${variantId}`,
    );
  });
});

describe("reserveVariantUnits", () => {
  const graphql = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves requested units from available to reserved", async () => {
    graphql
      .mockResolvedValueOnce(
        inventoryResponse({
          available: 8,
          reserved: 1,
          onHand: 9,
        }),
      )
      .mockResolvedValueOnce(moveSuccessResponse());

    const result = await reserveVariantUnits({
      graphql,
      variantId,
      locationId,
      quantityToReserve: 2,
      referenceDocumentUri,
      idempotencyKey: "reserve:contract-123:variant-123",
    });

    expect(result).toMatchObject({
      available: 8,
      reserved: 1,
      onHand: 9,
      quantityReserved: 2,
    });

    expect(graphql).toHaveBeenCalledTimes(2);

    const mutationCall = graphql.mock.calls[1][1];

    expect(mutationCall.variables).toEqual({
      idempotencyKey: "reserve:contract-123:variant-123",
      input: {
        reason: "reservation_created",
        referenceDocumentUri,
        changes: [
          {
            quantity: 2,
            inventoryItemId,
            from: {
              locationId,
              name: "available",
              ledgerDocumentUri: null,
              changeFromQuantity: 8,
            },
            to: {
              locationId,
              name: "reserved",
              ledgerDocumentUri: referenceDocumentUri,
              changeFromQuantity: 1,
            },
          },
        ],
      },
    });
  });

  it("does not mutate inventory when available stock is insufficient", async () => {
    graphql.mockResolvedValue(
      inventoryResponse({
        available: 1,
        reserved: 0,
        onHand: 1,
      }),
    );

    await expect(
      reserveVariantUnits({
        graphql,
        variantId,
        locationId,
        quantityToReserve: 2,
        referenceDocumentUri,
        idempotencyKey: "reserve:insufficient",
      }),
    ).rejects.toThrow(
      `Insufficient inventory for ${variantId}: required 2, available 1`,
    );

    expect(graphql).toHaveBeenCalledTimes(1);
  });
});

describe("releaseVariantUnits", () => {
  const graphql = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves requested units from reserved back to available", async () => {
    graphql
      .mockResolvedValueOnce(
        inventoryResponse({
          available: 6,
          reserved: 3,
          onHand: 9,
        }),
      )
      .mockResolvedValueOnce(moveSuccessResponse());

    const result = await releaseVariantUnits({
      graphql,
      variantId,
      locationId,
      quantityToRelease: 2,
      referenceDocumentUri,
      idempotencyKey: "release:contract-123:variant-123",
    });

    expect(result).toMatchObject({
      available: 6,
      reserved: 3,
      onHand: 9,
      quantityReleased: 2,
    });

    expect(graphql).toHaveBeenCalledTimes(2);

    const mutationCall = graphql.mock.calls[1][1];

    expect(mutationCall.variables).toEqual({
      idempotencyKey: "release:contract-123:variant-123",
      input: {
        reason: "reservation_deleted",
        referenceDocumentUri,
        changes: [
          {
            quantity: 2,
            inventoryItemId,
            from: {
              locationId,
              name: "reserved",
              ledgerDocumentUri: referenceDocumentUri,
              changeFromQuantity: 3,
            },
            to: {
              locationId,
              name: "available",
              ledgerDocumentUri: null,
              changeFromQuantity: 6,
            },
          },
        ],
      },
    });
  });

  it("does not mutate inventory when reserved stock is insufficient", async () => {
    graphql.mockResolvedValue(
      inventoryResponse({
        available: 8,
        reserved: 1,
        onHand: 9,
      }),
    );

    await expect(
      releaseVariantUnits({
        graphql,
        variantId,
        locationId,
        quantityToRelease: 2,
        referenceDocumentUri,
        idempotencyKey: "release:insufficient",
      }),
    ).rejects.toThrow(
      `Insufficient reserved inventory for ${variantId}: required 2, reserved 1`,
    );

    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("surfaces Shopify inventory mutation user errors", async () => {
    graphql
      .mockResolvedValueOnce(
        inventoryResponse({
          available: 5,
          reserved: 2,
          onHand: 7,
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            inventoryMoveQuantities: {
              inventoryAdjustmentGroup: null,
              userErrors: [
                {
                  code: "INVALID",
                  field: ["input"],
                  message: "Inventory move rejected",
                },
              ],
            },
          },
        }),
      );

    await expect(
      releaseVariantUnits({
        graphql,
        variantId,
        locationId,
        quantityToRelease: 1,
        referenceDocumentUri,
        idempotencyKey: "release:user-error",
      }),
    ).rejects.toThrow("Inventory reservation rejected");
  });
});


describe("releaseReservedVariantUnitForConsumption", () => {
  it("moves one reserved unit to available without a preflight read", async () => {
    const graphql = vi.fn();

    graphql.mockResolvedValue(moveSuccessResponse());

    await releaseReservedVariantUnitForConsumption({
      graphql,
      inventoryItemId,
      locationId,
      reservedLedgerDocumentUri:
        "lushka://subscription/123/future-reservation",
      referenceDocumentUri:
        "lushka://subscription/123/cycle/1/reserved-release",
      idempotencyKey:
        "consume-release:123:serum:cycle:1",
    });

    // A retry-safe consumption move must not perform an inventory
    // state read before replaying its deterministic Shopify mutation.
    expect(graphql).toHaveBeenCalledTimes(1);

    const mutationCall = graphql.mock.calls[0][1];

    expect(mutationCall.variables).toEqual({
      idempotencyKey:
        "consume-release:123:serum:cycle:1",
      input: {
        reason: "reservation_deleted",
        referenceDocumentUri:
          "lushka://subscription/123/cycle/1/reserved-release",
        changes: [
          {
            quantity: 1,
            inventoryItemId,
            from: {
              locationId,
              name: "reserved",
              ledgerDocumentUri:
                "lushka://subscription/123/future-reservation",
              changeFromQuantity: null,
            },
            to: {
              locationId,
              name: "available",
              ledgerDocumentUri: null,
              changeFromQuantity: null,
            },
          },
        ],
      },
    });
  });
});
