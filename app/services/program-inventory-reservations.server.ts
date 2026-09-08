import db from "../db.server";
import {
  getVariantInventoryState,
  releaseVariantUnits,
  reserveVariantUnits,
} from "./inventory-reservations.server";

type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

function contractReference(contractId: string): string {
  const id = contractId.split("/").pop() ?? contractId;

  return `lushka://subscription/${id}/future-reservation`;
}

function reservationKey(
  contractId: string,
  variantId: string,
  attempt: number,
): string {
  const contract = contractId.split("/").pop() ?? contractId;
  const variant = variantId.split("/").pop() ?? variantId;

  return `reserve:${contract}:${variant}:attempt:${attempt}`;
}

function rollbackKey(
  contractId: string,
  variantId: string,
  attempt: number,
): string {
  const contract = contractId.split("/").pop() ?? contractId;
  const variant = variantId.split("/").pop() ?? variantId;

  return `rollback:${contract}:${variant}:attempt:${attempt}`;
}

export async function reserveCompleteFutureInventory({
  graphql,
  shop,
  contractId,
  planType,
  locationId,
  variantIds,
  unitsPerVariant,
}: {
  graphql: AdminGraphql;
  shop: string;
  contractId: string;
  planType: string;
  locationId: string;
  variantIds: string[];
  unitsPerVariant: number;
}) {
  if (
    !Number.isInteger(unitsPerVariant) ||
    unitsPerVariant < 1
  ) {
    throw new Error(
      "Future reservation units must be a positive integer",
    );
  }

  const uniqueVariantIds = [...new Set(variantIds)];

  if (uniqueVariantIds.length === 0) {
    return {
      reserved: 0,
      skipped: 0,
    };
  }

  const existing =
    await db.inventoryReservation.findMany({
      where: {
        contractId,
        variantId: {
          in: uniqueVariantIds,
        },
      },
    });

  const existingByVariant = new Map(
    existing.map((row) => [row.variantId, row]),
  );

  /*
   * Reservation status safety:
   *
   * ACTIVE:
   *   Future stock is already protected, so skip it.
   *
   * CONSUMED:
   *   The programme reservation obligation is finished. Never reserve
   *   it again because a duplicate contract-create webhook may arrive
   *   long after the subscription has completed.
   *
   * ROLLED_BACK:
   *   The previous reservation attempt was compensated successfully,
   *   so this is the only status that may automatically retry.
   *
   * RECOVERY_REQUIRED:
   *   Inventory state is uncertain and requires manual reconciliation.
   *
   * RELEASED:
   *   Stock was intentionally returned to available inventory. It must
   *   not be automatically reserved again without an explicit resume
   *   workflow.
   */
  for (const row of existing) {
    if (row.status === "RECOVERY_REQUIRED") {
      throw new Error(
        "Programme inventory requires manual recovery",
      );
    }

    if (row.status === "RELEASED") {
      throw new Error(
        "Programme inventory reservation has been released",
      );
    }

    if (
      !["ACTIVE", "CONSUMED", "ROLLED_BACK"].includes(row.status)
    ) {
      throw new Error(
        `Unsupported programme inventory reservation status: ${row.status}`,
      );
    }
  }

  const protectedVariantIds = new Set(
    existing
      .filter(
        (row) =>
          row.status === "ACTIVE" ||
          row.status === "CONSUMED",
      )
      .map((row) => row.variantId),
  );

  const variantsToReserve = uniqueVariantIds.filter(
    (variantId) => !protectedVariantIds.has(variantId),
  );

  if (variantsToReserve.length === 0) {
    return {
      reserved: 0,
      skipped: uniqueVariantIds.length,
    };
  }

  /*
   * Preflight all required components before making any inventory
   * mutation. Each work item also receives its reservation attempt.
   */
  const workItems = await Promise.all(
    variantsToReserve.map(async (variantId) => {
      const state = await getVariantInventoryState({
        graphql,
        variantId,
        locationId,
      });

      if (state.available < unitsPerVariant) {
        throw new Error(
          `Insufficient future programme inventory for ${variantId}: ` +
            `required ${unitsPerVariant}, available ${state.available}`,
        );
      }

      const existingRow = existingByVariant.get(variantId);

      const attempt =
        existingRow?.status === "ROLLED_BACK"
          ? Number(existingRow.reservationAttempt ?? 1) + 1
          : 1;

      return {
        state,
        attempt,
      };
    }),
  );

  const completedReservations: typeof workItems = [];

  try {
    for (const workItem of workItems) {
      const { state, attempt } = workItem;

      await reserveVariantUnits({
        graphql,
        variantId: state.variantId,
        locationId,
        quantityToReserve: unitsPerVariant,
        referenceDocumentUri:
          contractReference(contractId),
        idempotencyKey: reservationKey(
          contractId,
          state.variantId,
          attempt,
        ),
      });

      /*
       * Record immediately after Shopify succeeds so a later DB or
       * component failure can trigger a compensating rollback.
       */
      completedReservations.push(workItem);

      await db.inventoryReservation.upsert({
        where: {
          contractId_variantId: {
            contractId,
            variantId: state.variantId,
          },
        },
        update: {
          shop,
          planType,
          inventoryItemId: state.inventoryItemId,
          locationId,
          reservedQuantity: unitsPerVariant,
          reservationAttempt: attempt,
          consumedQuantity: 0,
          releasedQuantity: 0,
          status: "ACTIVE",
        },
        create: {
          shop,
          contractId,
          planType,
          variantId: state.variantId,
          inventoryItemId: state.inventoryItemId,
          locationId,
          reservedQuantity: unitsPerVariant,
          reservationAttempt: attempt,
          consumedQuantity: 0,
          releasedQuantity: 0,
          status: "ACTIVE",
        },
      });
    }
  } catch (error) {
    /*
     * Roll back successful moves in reverse order. Attempt-specific
     * idempotency keys prevent collisions with older rollbacks.
     */
    for (const workItem of [...completedReservations].reverse()) {
      const { state, attempt } = workItem;

      try {
        await releaseVariantUnits({
          graphql,
          variantId: state.variantId,
          locationId,
          quantityToRelease: unitsPerVariant,
          referenceDocumentUri:
            contractReference(contractId),
          idempotencyKey: rollbackKey(
            contractId,
            state.variantId,
            attempt,
          ),
        });

        await db.inventoryReservation.updateMany({
          where: {
            contractId,
            variantId: state.variantId,
            status: "ACTIVE",
          },
          data: {
            releasedQuantity: unitsPerVariant,
            status: "ROLLED_BACK",
          },
        });
      } catch (rollbackError) {
        console.error(
          `Failed to roll back reservation for ${state.variantId}`,
          rollbackError,
        );
      }
    }

    throw error;
  }

  return {
    reserved: completedReservations.length,
    skipped: protectedVariantIds.size,
  };
}
