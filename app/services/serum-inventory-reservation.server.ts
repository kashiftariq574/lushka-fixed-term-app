import db from "../db.server";
import { SERUM } from "../domain/subscription-policy";
import {
  releaseReservedVariantUnitForConsumption,
  restoreReleasedVariantUnitForConsumption,
} from "./inventory-reservations.server";
import { releaseCompleteRemainingInventory } from "./program-inventory-release.server";

/*
 * Serum reservation helpers are for SERUM_RITUAL_90 subscription
 * contracts only.
 *
 * One-time Serum product purchases must remain on Shopify's standard
 * inventory path: they consume only the purchased available quantity,
 * never create InventoryReservation rows, and never call these helpers.
 * Reserved subscription stock is already unavailable to one-time buyers
 * because Shopify available inventory is reduced by the reservation.
 */

type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

const SERUM_BILLING_RELEASED_STATUSES = [
  "INVENTORY_RELEASED",
  "PENDING",
  "SUBMITTED",
  "CHALLENGED",
] as const;

function contractShortId(contractId: string): string {
  return contractId.split("/").pop() ?? contractId;
}

function variantShortId(variantId: string): string {
  return variantId.split("/").pop() ?? variantId;
}

function reservationLedgerUri(contractId: string): string {
  return `lushka://subscription/${contractShortId(contractId)}/future-reservation`;
}

async function requireSerumReservation(
  contractId: string,
  serumVariantId: string,
) {
  const row = await db.inventoryReservation.findUnique({
    where: {
      contractId_variantId: {
        contractId,
        variantId: serumVariantId,
      },
    },
  });

  if (!row) {
    throw new Error(
      `Serum inventory reservation not found for ${contractId}`,
    );
  }

  if (row.planType !== SERUM.code) {
    throw new Error(
      `Unexpected reservation plan type for Serum helper: ${row.planType}`,
    );
  }

  if (row.status === "RECOVERY_REQUIRED") {
    throw new Error(
      "Serum inventory requires manual recovery",
    );
  }

  return row;
}

export async function prepareSerumReservedInventoryForBilling({
  graphql,
  contractId,
  serumVariantId,
  cycleIndex,
}: {
  graphql: AdminGraphql;
  contractId: string;
  serumVariantId: string;
  cycleIndex: number;
}) {
  if (cycleIndex !== 1 && cycleIndex !== 2) {
    throw new Error(
      `Invalid Serum reservation billing cycle: ${cycleIndex}`,
    );
  }

  const row = await requireSerumReservation(
    contractId,
    serumVariantId,
  );

  if (
    row.releasedQuantity > 0 ||
    row.status === "RELEASED" ||
    row.status === "ROLLED_BACK" ||
    row.status === "CONSUMED"
  ) {
    throw new Error(
      "Serum reserved stock is no longer available for billing",
    );
  }

  const targetConsumedQuantity = cycleIndex;

  if (row.consumedQuantity >= targetConsumedQuantity) {
    return {
      released: 0,
      skipped: true,
      consumptionAttempt: Number(row.consumptionAttempt ?? 1),
    };
  }

  if (row.consumedQuantity !== targetConsumedQuantity - 1) {
    throw new Error(
      "Serum reservation billing sequence is invalid",
    );
  }

  const remaining =
    Number(row.reservedQuantity) -
    Number(row.consumedQuantity) -
    Number(row.releasedQuantity);

  if (remaining < 1) {
    throw new Error(
      "No unused Serum reservation remains for billing",
    );
  }

  const consumptionAttempt = Number(
    row.consumptionAttempt ?? 1,
  );
  const shortId = contractShortId(contractId);

  await releaseReservedVariantUnitForConsumption({
    graphql,
    inventoryItemId: row.inventoryItemId,
    locationId: row.locationId,
    reservedLedgerDocumentUri:
      reservationLedgerUri(contractId),
    referenceDocumentUri:
      `lushka://subscription/${shortId}/cycle/${cycleIndex}/serum-billing-release`,
    idempotencyKey:
      `serum-billing-release:${shortId}:${variantShortId(
        serumVariantId,
      )}:cycle:${cycleIndex}:attempt:${consumptionAttempt}`,
  });

  return {
    released: 1,
    skipped: false,
    consumptionAttempt,
  };
}

export async function restoreSerumReservedInventoryAfterFailedBilling({
  graphql,
  contractId,
  serumVariantId,
  cycleIndex,
}: {
  graphql: AdminGraphql;
  contractId: string;
  serumVariantId: string;
  cycleIndex: number;
}) {
  if (cycleIndex !== 1 && cycleIndex !== 2) {
    throw new Error(
      `Invalid Serum reservation restore cycle: ${cycleIndex}`,
    );
  }

  const row = await requireSerumReservation(
    contractId,
    serumVariantId,
  );

  if (
    row.status === "RELEASED" ||
    row.status === "ROLLED_BACK" ||
    row.status === "CONSUMED"
  ) {
    return {
      restored: 0,
      skipped: true,
    };
  }

  const targetConsumedQuantity = cycleIndex;

  /*
   * After a successful payment for this cycle, consumedQuantity already
   * advanced and there is nothing to restore.
   */
  if (row.consumedQuantity >= targetConsumedQuantity) {
    return {
      restored: 0,
      skipped: true,
    };
  }

  if (row.consumedQuantity !== targetConsumedQuantity - 1) {
    throw new Error(
      "Serum reservation restore sequence is invalid",
    );
  }

  const consumptionAttempt = Number(
    row.consumptionAttempt ?? 1,
  );
  const shortId = contractShortId(contractId);

  await restoreReleasedVariantUnitForConsumption({
    graphql,
    inventoryItemId: row.inventoryItemId,
    locationId: row.locationId,
    reservedLedgerDocumentUri:
      reservationLedgerUri(contractId),
    referenceDocumentUri:
      `lushka://subscription/${shortId}/cycle/${cycleIndex}/serum-billing-restore`,
    idempotencyKey:
      `serum-billing-restore:${shortId}:${variantShortId(
        serumVariantId,
      )}:cycle:${cycleIndex}:attempt:${consumptionAttempt}`,
  });

  /*
   * Advance the attempt generation so the next billing retry uses
   * fresh Shopify idempotency keys for release + restore.
   */
  await db.inventoryReservation.updateMany({
    where: {
      contractId,
      variantId: serumVariantId,
      consumptionAttempt,
    },
    data: {
      consumptionAttempt: consumptionAttempt + 1,
    },
  });

  return {
    restored: 1,
    skipped: false,
  };
}

export async function markSerumReservedInventoryConsumed({
  contractId,
  serumVariantId,
  cycleIndex,
}: {
  contractId: string;
  serumVariantId: string;
  cycleIndex: number;
}) {
  if (cycleIndex !== 1 && cycleIndex !== 2) {
    throw new Error(
      `Invalid Serum reservation consumption cycle: ${cycleIndex}`,
    );
  }

  const row = await requireSerumReservation(
    contractId,
    serumVariantId,
  );

  if (
    row.releasedQuantity > 0 ||
    row.status === "RELEASED" ||
    row.status === "ROLLED_BACK"
  ) {
    throw new Error(
      "Serum reserved stock is no longer available",
    );
  }

  const targetConsumedQuantity = cycleIndex;

  if (row.consumedQuantity >= targetConsumedQuantity) {
    return {
      consumed: 0,
      skipped: true,
    };
  }

  if (row.consumedQuantity !== targetConsumedQuantity - 1) {
    throw new Error(
      "Serum reservation consumption sequence is invalid",
    );
  }

  const usableReservedQuantity =
    Number(row.reservedQuantity) -
    Number(row.releasedQuantity);

  if (usableReservedQuantity < targetConsumedQuantity) {
    throw new Error(
      "Serum reserved stock is no longer available",
    );
  }

  await db.inventoryReservation.updateMany({
    where: {
      contractId,
      variantId: serumVariantId,
    },
    data: {
      consumedQuantity: targetConsumedQuantity,
      status:
        targetConsumedQuantity >=
        Number(row.reservedQuantity)
          ? "CONSUMED"
          : "ACTIVE",
    },
  });

  return {
    consumed: 1,
    skipped: false,
  };
}

async function restoreInFlightSerumBillingRelease({
  graphql,
  contractId,
  serumVariantId,
}: {
  graphql: AdminGraphql;
  contractId: string;
  serumVariantId: string;
}) {
  const inFlight = await db.billingAttempt.findFirst({
    where: {
      contractId,
      status: {
        in: [...SERUM_BILLING_RELEASED_STATUSES],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!inFlight) {
    return { restored: 0 };
  }

  await restoreSerumReservedInventoryAfterFailedBilling({
    graphql,
    contractId,
    serumVariantId,
    cycleIndex: inFlight.cycleIndex,
  });

  await db.billingAttempt.updateMany({
    where: {
      id: inFlight.id,
      status: {
        in: [...SERUM_BILLING_RELEASED_STATUSES],
      },
    },
    data: {
      status: "FAILED",
      error: "Abandoned due to programme inventory release",
    },
  });

  return { restored: 1 };
}

export async function releaseSerumRemainingInventory({
  graphql,
  contractId,
  serumVariantId,
  reason,
}: {
  graphql: AdminGraphql;
  contractId: string;
  serumVariantId: string;
  reason: string;
}) {
  await restoreInFlightSerumBillingRelease({
    graphql,
    contractId,
    serumVariantId,
  });

  return releaseCompleteRemainingInventory({
    graphql,
    contractId,
    variantIds: [serumVariantId],
    reason,
  });
}
