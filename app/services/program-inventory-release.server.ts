import db from "../db.server";
import {
  releaseReservedVariantUnits,
} from "./inventory-reservations.server";

type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

function shortId(id: string): string {
  return id.split("/").pop() ?? id;
}

function reservationReference(contractId: string): string {
  return `lushka://subscription/${shortId(contractId)}/future-reservation`;
}

function releaseReference(
  contractId: string,
  reason: string,
): string {
  return `lushka://subscription/${shortId(contractId)}/${reason}`;
}

function releaseKey(
  contractId: string,
  variantId: string,
  reason: string,
): string {
  return [
    "programme-release",
    shortId(contractId),
    shortId(variantId),
    reason,
  ].join(":");
}

export async function releaseCompleteRemainingInventory({
  graphql,
  contractId,
  variantIds,
  reason,
}: {
  graphql: AdminGraphql;
  contractId: string;
  variantIds: string[];
  reason: string;
}) {
  const uniqueVariantIds = [...new Set(variantIds)];

  if (uniqueVariantIds.length === 0) {
    return {
      released: 0,
      skipped: 0,
    };
  }

  const rows = await db.inventoryReservation.findMany({
    where: {
      contractId,
      variantId: {
        in: uniqueVariantIds,
      },
    },
  });

  if (rows.length !== uniqueVariantIds.length) {
    throw new Error(
      "Incomplete programme inventory reservation set",
    );
  }

  const rowsByVariant = new Map(
    rows.map((row) => [row.variantId, row]),
  );

  for (const variantId of uniqueVariantIds) {
    if (!rowsByVariant.has(variantId)) {
      throw new Error(
        "Incomplete programme inventory reservation set",
      );
    }
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

  let released = 0;
  let skipped = 0;

  for (const variantId of uniqueVariantIds) {
    const row = rowsByVariant.get(variantId)!;

    const remaining =
      Number(row.reservedQuantity) -
      Number(row.consumedQuantity) -
      Number(row.releasedQuantity);

    if (remaining < 0) {
      throw new Error(
        `Invalid programme inventory quantities for ${variantId}`,
      );
    }

    if (
      remaining === 0 ||
      row.status === "CONSUMED" ||
      row.status === "RELEASED"
    ) {
      skipped += 1;
      continue;
    }

    if (row.status === "ROLLED_BACK") {
      throw new Error(
        `Rolled-back programme inventory still has reserved quantity for ${variantId}`,
      );
    }

    if (row.status !== "ACTIVE") {
      throw new Error(
        `Unsupported programme inventory reservation status: ${row.status}`,
      );
    }

    await releaseReservedVariantUnits({
      graphql,
      inventoryItemId: row.inventoryItemId,
      locationId: row.locationId,
      quantityToRelease: remaining,
      reservedLedgerDocumentUri:
        reservationReference(contractId),
      referenceDocumentUri:
        releaseReference(contractId, reason),
      idempotencyKey:
        releaseKey(
          contractId,
          variantId,
          reason,
        ),
    });

    /*
     * Set the final released quantity rather than incrementing it.
     *
     * If Shopify completed the release and this worker crashed before
     * the DB write, the same deterministic mutation can be replayed and
     * this update remains idempotent.
     */
    await db.inventoryReservation.updateMany({
      where: {
        contractId,
        variantId,
        status: "ACTIVE",
      },
      data: {
        releasedQuantity:
          Number(row.releasedQuantity) + remaining,
        status: "RELEASED",
      },
    });

    released += 1;
  }

  return {
    released,
    skipped,
  };
}
