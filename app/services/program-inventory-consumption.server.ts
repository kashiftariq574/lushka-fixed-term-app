import db from "../db.server";
import { deductVariantInventory } from "./inventory.server";
import {
  releaseReservedVariantUnitForConsumption,
  reserveVariantUnits,
} from "./inventory-reservations.server";

type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

function contractShortId(contractId: string): string {
  return contractId.split("/").pop() ?? contractId;
}

function variantShortId(variantId: string): string {
  return variantId.split("/").pop() ?? variantId;
}

export async function consumeCompleteReservedInventory({
  graphql,
  contractId,
  locationId,
  variantIds,
  cycleIndex,
}: {
  graphql: AdminGraphql;
  contractId: string;
  locationId: string;
  variantIds: string[];
  cycleIndex: number;
}) {
  if (cycleIndex !== 1 && cycleIndex !== 2) {
    throw new Error(
      `Invalid Complete reservation consumption cycle: ${cycleIndex}`,
    );
  }

  const uniqueVariantIds = [...new Set(variantIds)];

  const rows = await db.inventoryReservation.findMany({
    where: {
      contractId,
      variantId: {
        in: uniqueVariantIds,
      },
    },
  });

  const byVariantId = new Map(
    rows.map((row) => [row.variantId, row]),
  );

  if (
    rows.length !== uniqueVariantIds.length ||
    uniqueVariantIds.some(
      (variantId) => !byVariantId.has(variantId),
    )
  ) {
    throw new Error(
      "Complete programme reservation set is incomplete",
    );
  }

  if (
    rows.some(
      (row) => row.status === "RECOVERY_REQUIRED",
    )
  ) {
    throw new Error(
      "Programme inventory requires manual recovery",
    );
  }

  for (const variantId of uniqueVariantIds) {
    const row = byVariantId.get(variantId)!;

    if (
      row.locationId !== locationId ||
      row.releasedQuantity > 0 ||
      row.status === "RELEASED" ||
      row.status === "ROLLED_BACK"
    ) {
      throw new Error(
        "Reserved programme stock is no longer available",
      );
    }
  }

  /*
   * Initial checkout = payment #1
   * cycle 1 = payment #2 = consume reserved unit #1
   * cycle 2 = payment #3 = consume reserved unit #2
   */
  const targetConsumedQuantity = cycleIndex;

  const consumedCounts = rows.map(
    (row) => row.consumedQuantity,
  );

  if (
    consumedCounts.every(
      (value) => value >= targetConsumedQuantity,
    )
  ) {
    return {
      consumed: 0,
      skipped: true,
    };
  }

  /*
   * Never continue from a partially advanced component set.
   */
  const distinctConsumedCounts =
    new Set(consumedCounts);

  if (distinctConsumedCounts.size !== 1) {
    throw new Error(
      "Complete programme reservation consumption state is inconsistent",
    );
  }

  const currentConsumedQuantity =
    consumedCounts[0] ?? 0;

  if (
    currentConsumedQuantity !==
    targetConsumedQuantity - 1
  ) {
    throw new Error(
      "Complete programme reservation consumption sequence is invalid",
    );
  }

  for (const row of rows) {
    const usableReservedQuantity =
      row.reservedQuantity - row.releasedQuantity;

    if (
      usableReservedQuantity <
      targetConsumedQuantity
    ) {
      throw new Error(
        "Reserved programme stock is no longer available",
      );
    }
  }

  /*
   * All component rows must share the same consumption attempt.
   * This keeps every Shopify idempotency key in one retry generation.
   */
  const consumptionAttempts = new Set(
    rows.map(
      (row) =>
        Number(row.consumptionAttempt ?? 1),
    ),
  );

  if (consumptionAttempts.size !== 1) {
    throw new Error(
      "Complete programme consumption attempt state is inconsistent",
    );
  }

  const consumptionAttempt =
    [...consumptionAttempts][0] ?? 1;

  const shortId =
    contractShortId(contractId);

  const reservationLedgerUri =
    `lushka://subscription/${shortId}/future-reservation`;

  const releasedRows: typeof rows = [];

  try {
    /*
     * Step 1:
     * Move exactly one programme unit for each component
     * from reserved back to available.
     */
    for (const row of rows) {
      await releaseReservedVariantUnitForConsumption({
        graphql,
        inventoryItemId: row.inventoryItemId,
        locationId,
        reservedLedgerDocumentUri:
          reservationLedgerUri,
        referenceDocumentUri:
          `lushka://subscription/${shortId}/cycle/${cycleIndex}/reserved-release`,
        idempotencyKey:
          `consume-release:${shortId}:${variantShortId(
            row.variantId,
          )}:cycle:${cycleIndex}:attempt:${consumptionAttempt}`,
      });

      releasedRows.push(row);
    }

    /*
     * Step 2:
     * Immediately consume the just-released physical units.
     * Shopify idempotency prevents a webhook retry from
     * decrementing them twice.
     */
    await deductVariantInventory({
      graphql,
      variantIds: uniqueVariantIds,
      locationId,
      idempotencyKey:
        `consume-available:${shortId}:cycle:${cycleIndex}:attempt:${consumptionAttempt}`,
      referenceDocumentUri:
        `lushka://subscription/${shortId}/cycle/${cycleIndex}/physical-consumption`,
    });
  } catch (error) {
    /*
     * If either a later release or the final physical deduction
     * fails, put every successfully released component back into
     * the programme reservation before allowing another retry.
     */
    const rollbackErrors: unknown[] = [];

    for (const row of [...releasedRows].reverse()) {
      try {
        await reserveVariantUnits({
          graphql,
          variantId: row.variantId,
          locationId,
          quantityToReserve: 1,
          referenceDocumentUri:
            reservationLedgerUri,
          idempotencyKey:
            `consume-release-rollback:${shortId}:${variantShortId(
              row.variantId,
            )}:cycle:${cycleIndex}:attempt:${consumptionAttempt}`,
        });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);

        console.error(
          `Failed to restore reserved stock for ${row.variantId}`,
          rollbackError,
        );
      }
    }

    /*
     * Only advance the attempt generation if compensation
     * completed successfully. The next webhook retry then receives
     * completely fresh Shopify idempotency keys.
     */
    if (
      releasedRows.length > 0 &&
      rollbackErrors.length === 0
    ) {
      await db.inventoryReservation.updateMany({
        where: {
          contractId,
          variantId: {
            in: uniqueVariantIds,
          },
          consumptionAttempt,
        },
        data: {
          consumptionAttempt:
            consumptionAttempt + 1,
        },
      });
    }

    if (rollbackErrors.length > 0) {
      await db.inventoryReservation.updateMany({
        where: {
          contractId,
          variantId: {
            in: uniqueVariantIds,
          },
        },
        data: {
          status: "RECOVERY_REQUIRED",
        },
      });

      throw new Error(
        "Programme inventory consumption failed and reservation rollback was incomplete",
        { cause: error },
      );
    }

    throw error;
  }

  await db.inventoryReservation.updateMany({
    where: {
      contractId,
      variantId: {
        in: uniqueVariantIds,
      },
    },
    data: {
      consumedQuantity:
        targetConsumedQuantity,
      status:
        targetConsumedQuantity >= 2
          ? "CONSUMED"
          : "ACTIVE",
    },
  });

  return {
    consumed: uniqueVariantIds.length,
    skipped: false,
  };
}
