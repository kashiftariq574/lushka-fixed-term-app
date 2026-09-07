import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { COMPLETE, SERUM } from "../domain/subscription-policy";
import { deductVariantInventory } from "../services/inventory.server";

type ContractCreatePayload = {
  admin_graphql_api_id?: string;
  admin_graphql_api_customer_id?: string | null;
  admin_graphql_api_origin_order_id?: string | null;
  status?: string;
};

const CONTRACT_QUERY = `#graphql
  query ContractForInitialProcessing($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      nextBillingDate

      customer {
        id
      }

      lines(first: 10) {
        nodes {
          sellingPlanId
          quantity
        }
      }
    }
  }
`;

function requireValue(
  value: string | null | undefined,
  name: string,
): string {
  if (!value) {
    throw new Error(`Missing ShopConfig value: ${name}`);
  }

  return value;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    return new Response("Admin API unavailable", { status: 500 });
  }

  const webhook = payload as ContractCreatePayload;

  const contractId = webhook.admin_graphql_api_id;
  const originOrderId = webhook.admin_graphql_api_origin_order_id;

  if (!contractId || !originOrderId) {
    return new Response(
      "Subscription contract webhook missing contract/origin order ID",
      { status: 400 },
    );
  }

  const config = await db.shopConfig.findUnique({
    where: { shop },
  });

  if (!config?.locationId) {
    return new Response("ShopConfig/location is not configured", {
      status: 500,
    });
  }

  const response = await admin.graphql(CONTRACT_QUERY, {
    variables: {
      id: contractId,
    },
  });

  const json: any = await response.json();

  if (json.errors?.length) {
    console.error(json.errors);

    return new Response("Unable to read subscription contract", {
      status: 500,
    });
  }

  const contract = json.data?.subscriptionContract;

  if (!contract) {
    return new Response("Subscription contract not found", {
      status: 404,
    });
  }

  const lines = contract.lines?.nodes ?? [];

  const sellingPlanIds = new Set(
    lines
      .map((line: any) => line?.sellingPlanId)
      .filter(Boolean),
  );

  const lushkaLines = lines.filter(
    (line: any) =>
      line?.sellingPlanId === config.completeSellingPlanId ||
      line?.sellingPlanId === config.serumSellingPlanId,
  );

  if (
    lushkaLines.length !== 1 ||
    Number(lushkaLines[0]?.quantity) !== 1
  ) {
    console.error(
      `Invalid LUSHKA subscription quantity for contract ${contractId}`,
      lushkaLines,
    );

    return new Response(
      "LUSHKA subscriptions require exactly one subscription unit",
      { status: 422 },
    );
  }

  let planType: string;
  let variantIds: string[];

  if (
    config.completeSellingPlanId &&
    sellingPlanIds.has(config.completeSellingPlanId)
  ) {
    planType = COMPLETE.code;

    variantIds = [
      requireValue(config.serumVariantId, "serumVariantId"),
      requireValue(config.shampooVariantId, "shampooVariantId"),
      requireValue(config.conditionerVariantId, "conditionerVariantId"),
      requireValue(config.maskVariantId, "maskVariantId"),
      requireValue(config.oilVariantId, "oilVariantId"),
    ];

    if (config.massagerVariantId) {
      variantIds.push(config.massagerVariantId);
    }
  } else if (
    config.serumSellingPlanId &&
    sellingPlanIds.has(config.serumSellingPlanId)
  ) {
    planType = SERUM.code;

    // Serum Ritual uses the real Shopify serum variant.
    // Shopify decrements that variant inventory on the actual order,
    // so the app must not manually decrement it again.
    variantIds = [];
  } else {
    console.error(
      `Ignoring unknown subscription plan for contract ${contractId}`,
    );

    return new Response();
  }

  const customerId =
    contract.customer?.id ??
    webhook.admin_graphql_api_customer_id ??
    null;

  const nextBillingAt = contract.nextBillingDate
    ? new Date(contract.nextBillingDate)
    : null;

  await db.contractState.upsert({
    where: {
      contractId,
    },
    update: {
      customerId,
      planType,
      status: String(
        contract.status ?? webhook.status ?? "ACTIVE",
      ).toUpperCase(),
      nextBillingAt,
    },
    create: {
      shop,
      contractId,
      customerId,
      planType,
      status: String(
        contract.status ?? webhook.status ?? "ACTIVE",
      ).toUpperCase(),

      // Initial checkout is payment #1.
      successfulCycleCount: 1,

      lastOrderId: originOrderId,
      nextBillingAt,
    },
  });

  const initialInventoryKey = `initial:${contractId}`;

  const inventoryAlreadyProcessed =
    await db.inventoryProcess.findUnique({
      where: {
        idempotencyKey: initialInventoryKey,
      },
    });

  if (!inventoryAlreadyProcessed) {
    if (variantIds.length > 0) {
      await deductVariantInventory({
        graphql: admin.graphql,
        variantIds,
        locationId: config.locationId,
        idempotencyKey: `inventory:${initialInventoryKey}`,
        referenceDocumentUri:
          `lushka://subscription/${contractId.split("/").pop()}/initial`,
      });
    }

    await db.inventoryProcess.upsert({
      where: {
        idempotencyKey: initialInventoryKey,
      },
      update: {},
      create: {
        shop,
        orderId: originOrderId,
        planType,
        idempotencyKey: initialInventoryKey,
      },
    });

    console.log(
      `Initial inventory processed: ${planType}, order ${originOrderId}`,
    );
  } else {
    console.log(
      `Initial inventory already processed for ${contractId}`,
    );
  }

  return new Response();
};
