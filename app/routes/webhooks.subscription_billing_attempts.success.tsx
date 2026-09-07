import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { assertBillableCycle, COMPLETE, SERUM, isCompleteAfterSuccess } from "../domain/subscription-policy";
import { deductVariantInventory } from "../services/inventory.server";

type BillingSuccessPayload = {
  idempotency_key?: string;
  admin_graphql_api_order_id?: string | null;
  admin_graphql_api_subscription_contract_id?: string | null;
  ready?: boolean;
};

const CONTRACT_QUERY = `#graphql
  query ContractPlan($id: ID!) {
    subscriptionContract(id: $id) {
      id
      nextBillingDate
      lines(first: 10) {
        nodes {
          sellingPlanId
          variantId
          quantity
        }
      }
    }
  }
`;

function cycleFromBillingKey(key: string, contractId: string): number {
  const prefix = `lushka:${contractId}:cycle:`;

  if (!key.startsWith(prefix)) {
    throw new Error(`Unexpected billing idempotency key: ${key}`);
  }

  const remainder = key.slice(prefix.length);
  const cyclePart = remainder.split(":")[0];
  const cycleIndex = Number(cyclePart);

  assertBillableCycle(cycleIndex);

  return cycleIndex;
}

function requireValue(value: string | null | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ShopConfig value: ${name}`);
  }

  return value;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic, session } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin || !session) {
    return new Response("Admin session unavailable", { status: 500 });
  }

  const billing = payload as BillingSuccessPayload;

  if (billing.ready === false) {
    return new Response();
  }

  const billingKey = billing.idempotency_key;
  const orderId = billing.admin_graphql_api_order_id;
  const contractId = billing.admin_graphql_api_subscription_contract_id;

  if (!billingKey || !orderId || !contractId) {
    return new Response("Billing webhook missing required identifiers", {
      status: 400,
    });
  }

  // Fast duplicate guard at our DB layer.
  const alreadyProcessed = await db.inventoryProcess.findUnique({
    where: {
      idempotencyKey: billingKey,
    },
  });

  if (alreadyProcessed) {
    console.log(`Inventory already processed for ${billingKey}`);
    return new Response();
  }

  const cycleIndex = cycleFromBillingKey(billingKey, contractId);

  const config = await db.shopConfig.findUnique({
    where: {
      shop,
    },
  });

  if (!config?.locationId) {
    return new Response("ShopConfig/location is not configured", {
      status: 500,
    });
  }

  const contractResponse = await admin.graphql(CONTRACT_QUERY, {
    variables: {
      id: contractId,
    },
  });

  const contractJson: any = await contractResponse.json();

  if (contractJson.errors?.length) {
    console.error(contractJson.errors);
    return new Response("Unable to read subscription contract", {
      status: 500,
    });
  }

  const contract = contractJson.data?.subscriptionContract;

  const lines = contract?.lines?.nodes ?? [];

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
      `Invalid LUSHKA subscription quantity for renewal contract ${contractId}`,
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
    return new Response("Unknown LUSHKA subscription selling plan", {
      status: 500,
    });
  }

  const contractState = await db.contractState.findUnique({
    where: {
      contractId,
    },
  });

  if (!contractState) {
    return new Response("ContractState not found", {
      status: 500,
    });
  }

  const successfulCycleCount = cycleIndex + 1;

  if (successfulCycleCount <= contractState.successfulCycleCount) {
    console.log(
      `Ignoring stale/already-applied billing success for cycle ${cycleIndex}, contract ${contractId}`,
    );

    await db.billingAttempt.updateMany({
      where: {
        idempotencyKey: billingKey,
      },
      data: {
        status: "SUCCESS",
        shopifyOrderId: orderId,
        error: null,
      },
    });

    return new Response();
  }

  const inventoryIdempotencyKey = `inventory:${billingKey}`;

  if (variantIds.length > 0) {
    await deductVariantInventory({
      graphql: admin.graphql,
      variantIds,
      locationId: config.locationId,
      idempotencyKey: inventoryIdempotencyKey,
      referenceDocumentUri:
        `lushka://subscription/${contractId.split("/").pop()}/cycle/${cycleIndex}`,
    });
  }

  const completed = isCompleteAfterSuccess(successfulCycleCount);

  await db.contractState.update({
    where: {
      contractId,
    },
    data: {
      successfulCycleCount,
      lastSuccessfulCycle: cycleIndex,
      lastOrderId: orderId,
      status: completed ? "COMPLETED" : "ACTIVE",
      completedAt: completed ? new Date() : null,
      nextBillingAt: completed
        ? null
        : contract?.nextBillingDate
          ? new Date(contract.nextBillingDate)
          : contractState.nextBillingAt,
    },
  });

  console.log(
    `ContractState updated: payment ${successfulCycleCount}/3, contract ${contractId}`,
  );

  await db.billingAttempt.updateMany({
    where: {
      idempotencyKey: billingKey,
    },
    data: {
      status: "SUCCESS",
      shopifyOrderId: orderId,
      error: null,
    },
  });

  console.log(
    `BillingAttempt marked SUCCESS: cycle ${cycleIndex}, contract ${contractId}`,
  );

  // Shopify's inventory mutation is also idempotent, so even if two webhook
  // deliveries race before this row exists, the same inventory mutation key
  // cannot decrement inventory twice.
  await db.inventoryProcess.upsert({
    where: {
      idempotencyKey: billingKey,
    },
    update: {},
    create: {
      shop,
      orderId,
      planType,
      idempotencyKey: billingKey,
    },
  });

  console.log(
    `Inventory processed: ${planType}, cycle ${cycleIndex}, order ${orderId}`,
  );

  return new Response();
};
