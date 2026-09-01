export type ComponentMap = {
  serumInventoryItemId: string;
  shampooInventoryItemId: string;
  conditionerInventoryItemId: string;
  maskInventoryItemId: string;
  oilInventoryItemId: string;
  massagerInventoryItemId?: string;
};

export function completeRecoveryAdjustments(
  map: ComponentMap,
  cycleIndex: number,
) {
  if (cycleIndex < 1 || cycleIndex > 3) {
    throw new Error("Invalid Complete Recovery cycle");
  }

  const rows = [
    map.serumInventoryItemId,
    map.shampooInventoryItemId,
    map.conditionerInventoryItemId,
    map.maskInventoryItemId,
    map.oilInventoryItemId,
  ].map((inventoryItemId) => ({
    inventoryItemId,
    delta: -1,
  }));

  if (cycleIndex === 1 && map.massagerInventoryItemId) {
    rows.push({
      inventoryItemId: map.massagerInventoryItemId,
      delta: -1,
    });
  }

  return rows;
}

export function serumRitualAdjustments(serumInventoryItemId: string) {
  return [{ inventoryItemId: serumInventoryItemId, delta: -1 }];
}

type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

const RESOLVE_INVENTORY_ITEMS = `#graphql
  query ResolveInventoryItems($variantIds: [ID!]!) {
    nodes(ids: $variantIds) {
      ... on ProductVariant {
        id
        inventoryItem {
          id
          tracked
        }
      }
    }
  }
`;

const ADJUST_INVENTORY = `#graphql
  mutation AdjustInventory(
    $input: InventoryAdjustQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventoryAdjustQuantities(input: $input)
      @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        id
        reason
        referenceDocumentUri
        changes {
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

export async function deductVariantInventory({
  graphql,
  variantIds,
  locationId,
  idempotencyKey,
  referenceDocumentUri,
}: {
  graphql: AdminGraphql;
  variantIds: string[];
  locationId: string;
  idempotencyKey: string;
  referenceDocumentUri: string;
}) {
  const uniqueVariantIds = [...new Set(variantIds)];

  if (uniqueVariantIds.length === 0) {
    return null;
  }

  const resolveResponse = await graphql(RESOLVE_INVENTORY_ITEMS, {
    variables: {
      variantIds: uniqueVariantIds,
    },
  });

  const resolveJson: any = await resolveResponse.json();

  if (resolveJson.errors?.length) {
    throw new Error(
      `Failed to resolve inventory items: ${JSON.stringify(resolveJson.errors)}`,
    );
  }

  const nodes = resolveJson.data?.nodes ?? [];

  const byVariantId = new Map(
    nodes
      .filter((node: any) => node?.id)
      .map((node: any) => [node.id, node]),
  );

  const changes = uniqueVariantIds.map((variantId) => {
    const variant: any = byVariantId.get(variantId);

    if (!variant?.inventoryItem?.id) {
      throw new Error(`Inventory item not found for variant ${variantId}`);
    }

    if (!variant.inventoryItem.tracked) {
      throw new Error(`Inventory is not tracked for variant ${variantId}`);
    }

    return {
      inventoryItemId: variant.inventoryItem.id,
      locationId,
      delta: -1,

      // Required in API 2026-04+.
      // null intentionally opts out of CAS because this is a relative
      // decrement protected by Shopify idempotency.
      changeFromQuantity: null,
    };
  });

  const adjustResponse = await graphql(ADJUST_INVENTORY, {
    variables: {
      idempotencyKey,
      input: {
        reason: "correction",
        name: "available",
        referenceDocumentUri,
        changes,
      },
    },
  });

  const adjustJson: any = await adjustResponse.json();

  if (adjustJson.errors?.length) {
    throw new Error(
      `Inventory GraphQL error: ${JSON.stringify(adjustJson.errors)}`,
    );
  }

  const payload = adjustJson.data?.inventoryAdjustQuantities;
  const userErrors = payload?.userErrors ?? [];

  if (userErrors.length) {
    throw new Error(
      `Inventory adjustment rejected: ${JSON.stringify(userErrors)}`,
    );
  }

  return payload?.inventoryAdjustmentGroup ?? null;
}
