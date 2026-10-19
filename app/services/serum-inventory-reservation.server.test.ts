import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  reservationFindUnique,
  reservationUpdateMany,
  billingFindFirst,
  billingUpdateMany,
  releaseUnitMock,
  restoreUnitMock,
  releaseCompleteRemainingMock,
} = vi.hoisted(() => ({
  reservationFindUnique: vi.fn(),
  reservationUpdateMany: vi.fn(),
  billingFindFirst: vi.fn(),
  billingUpdateMany: vi.fn(),
  releaseUnitMock: vi.fn(),
  restoreUnitMock: vi.fn(),
  releaseCompleteRemainingMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    inventoryReservation: {
      findUnique: reservationFindUnique,
      updateMany: reservationUpdateMany,
    },
    billingAttempt: {
      findFirst: billingFindFirst,
      updateMany: billingUpdateMany,
    },
  },
}));

vi.mock("./inventory-reservations.server", () => ({
  releaseReservedVariantUnitForConsumption: releaseUnitMock,
  restoreReleasedVariantUnitForConsumption: restoreUnitMock,
}));

vi.mock("./program-inventory-release.server", () => ({
  releaseCompleteRemainingInventory: releaseCompleteRemainingMock,
}));

import { SERUM } from "../domain/subscription-policy";
import {
  markSerumReservedInventoryConsumed,
  prepareSerumReservedInventoryForBilling,
  releaseSerumRemainingInventory,
  restoreSerumReservedInventoryAfterFailedBilling,
} from "./serum-inventory-reservation.server";

const contractId = "gid://shopify/SubscriptionContract/123";
const serumVariantId = "gid://shopify/ProductVariant/serum";
const graphql = vi.fn();

const activeRow = {
  contractId,
  variantId: serumVariantId,
  planType: SERUM.code,
  inventoryItemId: "gid://shopify/InventoryItem/1",
  locationId: "gid://shopify/Location/1",
  reservedQuantity: 2,
  consumedQuantity: 0,
  releasedQuantity: 0,
  consumptionAttempt: 1,
  status: "ACTIVE",
};

describe("serum inventory reservation helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseUnitMock.mockResolvedValue({});
    restoreUnitMock.mockResolvedValue({});
    reservationUpdateMany.mockResolvedValue({ count: 1 });
    billingUpdateMany.mockResolvedValue({ count: 1 });
    releaseCompleteRemainingMock.mockResolvedValue({
      released: 1,
      skipped: 0,
    });
  });

  it("releases one reserved Serum unit for billing without deducting", async () => {
    reservationFindUnique.mockResolvedValue(activeRow);

    const result = await prepareSerumReservedInventoryForBilling({
      graphql,
      contractId,
      serumVariantId,
      cycleIndex: 1,
    });

    expect(result).toEqual({
      released: 1,
      skipped: false,
      consumptionAttempt: 1,
    });

    expect(releaseUnitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryItemId: activeRow.inventoryItemId,
        locationId: activeRow.locationId,
        idempotencyKey:
          "serum-billing-release:123:serum:cycle:1:attempt:1",
      }),
    );
  });

  it("refuses to run when the reservation is not SERUM_RITUAL_90", async () => {
    reservationFindUnique.mockResolvedValue({
      ...activeRow,
      planType: "COMPLETE_RECOVERY_90",
    });

    await expect(
      prepareSerumReservedInventoryForBilling({
        graphql,
        contractId,
        serumVariantId,
        cycleIndex: 1,
      }),
    ).rejects.toThrow(
      "Unexpected reservation plan type for Serum helper",
    );

    expect(releaseUnitMock).not.toHaveBeenCalled();
  });

  it("marks consumedQuantity on success without Shopify deduction", async () => {
    reservationFindUnique.mockResolvedValue({
      ...activeRow,
      consumedQuantity: 0,
    });

    const first = await markSerumReservedInventoryConsumed({
      contractId,
      serumVariantId,
      cycleIndex: 1,
    });

    expect(first).toEqual({ consumed: 1, skipped: false });
    expect(reservationUpdateMany).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: serumVariantId,
      },
      data: {
        consumedQuantity: 1,
        status: "ACTIVE",
      },
    });

    reservationFindUnique.mockResolvedValue({
      ...activeRow,
      consumedQuantity: 1,
    });

    const second = await markSerumReservedInventoryConsumed({
      contractId,
      serumVariantId,
      cycleIndex: 2,
    });

    expect(second).toEqual({ consumed: 1, skipped: false });
    expect(reservationUpdateMany).toHaveBeenLastCalledWith({
      where: {
        contractId,
        variantId: serumVariantId,
      },
      data: {
        consumedQuantity: 2,
        status: "CONSUMED",
      },
    });
  });

  it("restores a released Serum unit after failed billing and bumps attempt", async () => {
    reservationFindUnique.mockResolvedValue(activeRow);

    const result =
      await restoreSerumReservedInventoryAfterFailedBilling({
        graphql,
        contractId,
        serumVariantId,
        cycleIndex: 1,
      });

    expect(result).toEqual({ restored: 1, skipped: false });
    expect(restoreUnitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "serum-billing-restore:123:serum:cycle:1:attempt:1",
      }),
    );
    expect(reservationUpdateMany).toHaveBeenCalledWith({
      where: {
        contractId,
        variantId: serumVariantId,
        consumptionAttempt: 1,
      },
      data: {
        consumptionAttempt: 2,
      },
    });
  });

  it("releases unused Serum reservations after payment #1 cancellation", async () => {
    billingFindFirst.mockResolvedValue(null);

    await releaseSerumRemainingInventory({
      graphql,
      contractId,
      serumVariantId,
      reason: "contract-terminal",
    });

    expect(restoreUnitMock).not.toHaveBeenCalled();
    expect(releaseCompleteRemainingMock).toHaveBeenCalledWith({
      graphql,
      contractId,
      variantIds: [serumVariantId],
      reason: "contract-terminal",
    });
  });

  it("restores in-flight billing release before terminal Serum release", async () => {
    billingFindFirst.mockResolvedValue({
      id: "attempt-1",
      cycleIndex: 1,
      status: "CHALLENGED",
    });
    reservationFindUnique.mockResolvedValue(activeRow);

    await releaseSerumRemainingInventory({
      graphql,
      contractId,
      serumVariantId,
      reason: "contract-terminal",
    });

    expect(restoreUnitMock).toHaveBeenCalled();
    expect(billingUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "attempt-1",
        status: {
          in: [
            "INVENTORY_RELEASED",
            "PENDING",
            "SUBMITTED",
            "CHALLENGED",
          ],
        },
      },
      data: {
        status: "FAILED",
        error: "Abandoned due to programme inventory release",
      },
    });
    expect(releaseCompleteRemainingMock).toHaveBeenCalled();
  });
});
