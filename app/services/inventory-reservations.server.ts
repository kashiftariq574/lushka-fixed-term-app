type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

export type VariantInventoryState = {
  variantId: string;
  inventoryItemId: string;
  locationId: string;
  available: number;
  reserved: number;
  onHand: number;
};

const VARIANT_INVENTORY_QUERY = `#graphql
  query VariantReservationInventory(
    $variantId: ID!
    $locationId: ID!
  ) {
    node(id: $variantId) {
      ... on ProductVariant {
        id
        inventoryItem {
          id
          tracked
          inventoryLevel(locationId: $locationId) {
            quantities(
              names: ["available", "reserved", "on_hand"]
            ) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

const MOVE_INVENTORY = `#graphql
  mutation MoveReservationInventory(
    $input: InventoryMoveQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventoryMoveQuantities(input: $input)
      @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        id
        reason
        referenceDocumentUri
        changes(
          quantityNames: ["available", "reserved", "on_hand"]
        ) {
          name
          delta
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

function quantity(
  quantities: Array<{ name?: string; quantity?: number }> | undefined,
  name: string,
): number {
  return Number(
    quantities?.find((row) => row?.name === name)?.quantity ?? 0,
  );
}

export async function getVariantInventoryState({
  graphql,
  variantId,
  locationId,
}: {
  graphql: AdminGraphql;
  variantId: string;
  locationId: string;
}): Promise<VariantInventoryState> {
  const response = await graphql(VARIANT_INVENTORY_QUERY, {
    variables: {
      variantId,
      locationId,
    },
  });

  const json: any = await response.json();

  if (json.errors?.length) {
    throw new Error(
      `Unable to read inventory state: ${JSON.stringify(json.errors)}`,
    );
  }

  const variant = json.data?.node;

  if (!variant?.id) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  if (!variant.inventoryItem?.id) {
    throw new Error(
      `Inventory item not found for variant ${variantId}`,
    );
  }

  if (!variant.inventoryItem.tracked) {
    throw new Error(
      `Inventory is not tracked for variant ${variantId}`,
    );
  }

  const level = variant.inventoryItem.inventoryLevel;

  if (!level) {
    throw new Error(
      `Inventory level not found for variant ${variantId} at ${locationId}`,
    );
  }

  return {
    variantId,
    inventoryItemId: variant.inventoryItem.id,
    locationId,
    available: quantity(level.quantities, "available"),
    reserved: quantity(level.quantities, "reserved"),
    onHand: quantity(level.quantities, "on_hand"),
  };
}

async function moveInventory({
  graphql,
  inventoryItemId,
  locationId,
  quantityToMove,
  fromName,
  toName,
  fromQuantity,
  toQuantity,
  fromLedgerDocumentUri,
  toLedgerDocumentUri,
  reason,
  referenceDocumentUri,
  idempotencyKey,
}: {
  graphql: AdminGraphql;
  inventoryItemId: string;
  locationId: string;
  quantityToMove: number;
  fromName: "available" | "reserved";
  toName: "available" | "reserved";
  fromQuantity: number | null;
  toQuantity: number | null;
  fromLedgerDocumentUri?: string | null;
  toLedgerDocumentUri?: string | null;
  reason: "reservation_created" | "reservation_deleted";
  referenceDocumentUri: string;
  idempotencyKey: string;
}) {
  if (!Number.isInteger(quantityToMove) || quantityToMove < 1) {
    throw new Error("Reservation quantity must be a positive integer");
  }

  const response = await graphql(MOVE_INVENTORY, {
    variables: {
      idempotencyKey,
      input: {
        reason,
        referenceDocumentUri,
        changes: [
          {
            quantity: quantityToMove,
            inventoryItemId,
            from: {
              locationId,
              name: fromName,
              ledgerDocumentUri:
                fromLedgerDocumentUri !== undefined
                  ? fromLedgerDocumentUri
                  : fromName === "reserved"
                    ? referenceDocumentUri
                    : null,
              changeFromQuantity: fromQuantity,
            },
            to: {
              locationId,
              name: toName,
              ledgerDocumentUri:
                toLedgerDocumentUri !== undefined
                  ? toLedgerDocumentUri
                  : toName === "reserved"
                    ? referenceDocumentUri
                    : null,
              changeFromQuantity: toQuantity,
            },
          },
        ],
      },
    },
  });

  const json: any = await response.json();

  if (json.errors?.length) {
    throw new Error(
      `Inventory reservation GraphQL error: ${JSON.stringify(json.errors)}`,
    );
  }

  const payload = json.data?.inventoryMoveQuantities;
  const errors = payload?.userErrors ?? [];

  if (errors.length) {
    throw new Error(
      `Inventory reservation rejected: ${JSON.stringify(errors)}`,
    );
  }

  return payload?.inventoryAdjustmentGroup ?? null;
}

export async function reserveVariantUnits({
  graphql,
  variantId,
  locationId,
  quantityToReserve,
  referenceDocumentUri,
  idempotencyKey,
}: {
  graphql: AdminGraphql;
  variantId: string;
  locationId: string;
  quantityToReserve: number;
  referenceDocumentUri: string;
  idempotencyKey: string;
}) {
  const state = await getVariantInventoryState({
    graphql,
    variantId,
    locationId,
  });

  if (state.available < quantityToReserve) {
    throw new Error(
      `Insufficient inventory for ${variantId}: ` +
        `required ${quantityToReserve}, available ${state.available}`,
    );
  }

  await moveInventory({
    graphql,
    inventoryItemId: state.inventoryItemId,
    locationId,
    quantityToMove: quantityToReserve,
    fromName: "available",
    toName: "reserved",
    fromQuantity: state.available,
    toQuantity: state.reserved,
    reason: "reservation_created",
    referenceDocumentUri,
    idempotencyKey,
  });

  return {
    ...state,
    quantityReserved: quantityToReserve,
  };
}

export async function releaseVariantUnits({
  graphql,
  variantId,
  locationId,
  quantityToRelease,
  referenceDocumentUri,
  idempotencyKey,
}: {
  graphql: AdminGraphql;
  variantId: string;
  locationId: string;
  quantityToRelease: number;
  referenceDocumentUri: string;
  idempotencyKey: string;
}) {
  const state = await getVariantInventoryState({
    graphql,
    variantId,
    locationId,
  });

  if (state.reserved < quantityToRelease) {
    throw new Error(
      `Insufficient reserved inventory for ${variantId}: ` +
        `required ${quantityToRelease}, reserved ${state.reserved}`,
    );
  }

  await moveInventory({
    graphql,
    inventoryItemId: state.inventoryItemId,
    locationId,
    quantityToMove: quantityToRelease,
    fromName: "reserved",
    toName: "available",
    fromQuantity: state.reserved,
    toQuantity: state.available,
    reason: "reservation_deleted",
    referenceDocumentUri,
    idempotencyKey,
  });

  return {
    ...state,
    quantityReleased: quantityToRelease,
  };
}



export async function releaseReservedVariantUnits({
  graphql,
  inventoryItemId,
  locationId,
  quantityToRelease,
  reservedLedgerDocumentUri,
  referenceDocumentUri,
  idempotencyKey,
}: {
  graphql: AdminGraphql;
  inventoryItemId: string;
  locationId: string;
  quantityToRelease: number;
  reservedLedgerDocumentUri: string;
  referenceDocumentUri: string;
  idempotencyKey: string;
}) {
  /*
   * Intentionally no inventory preflight read.
   *
   * Payment-hold expiry may be retried after a worker crash.
   * Replaying the same Shopify mutation with the same idempotency key
   * must remain safe even if Shopify already performed the release.
   */
  return moveInventory({
    graphql,
    inventoryItemId,
    locationId,
    quantityToMove: quantityToRelease,
    fromName: "reserved",
    toName: "available",
    fromQuantity: null,
    toQuantity: null,
    fromLedgerDocumentUri: reservedLedgerDocumentUri,
    toLedgerDocumentUri: null,
    reason: "reservation_deleted",
    referenceDocumentUri,
    idempotencyKey,
  });
}



export async function releaseReservedVariantUnitForConsumption({
  graphql,
  inventoryItemId,
  locationId,
  reservedLedgerDocumentUri,
  referenceDocumentUri,
  idempotencyKey,
}: {
  graphql: AdminGraphql;
  inventoryItemId: string;
  locationId: string;
  reservedLedgerDocumentUri: string;
  referenceDocumentUri: string;
  idempotencyKey: string;
}) {
  /*
   * Intentionally do not pre-read inventory here.
   *
   * A renewal success webhook can be retried after a crash. Replaying
   * the exact same Shopify mutation with the same idempotency key is
   * safer than reading the already-changed quantity and constructing
   * a different request.
   */
  return moveInventory({
    graphql,
    inventoryItemId,
    locationId,
    quantityToMove: 1,
    fromName: "reserved",
    toName: "available",
    fromQuantity: null,
    toQuantity: null,
    fromLedgerDocumentUri: reservedLedgerDocumentUri,
    toLedgerDocumentUri: null,
    reason: "reservation_deleted",
    referenceDocumentUri,
    idempotencyKey,
  });
}
