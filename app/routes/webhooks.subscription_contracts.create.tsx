import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { COMPLETE, ROOT_REVIVAL, SERUM } from "../domain/subscription-policy";
import { deductVariantInventory } from "../services/inventory.server";
import { reserveCompleteFutureInventory } from "../services/program-inventory-reservations.server";
import { scheduleLifecycleEmails, scheduleRootRevivalLifecycleEmails } from "../services/lifecycle-email-events.server";

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
      createdAt
      nextBillingDate

      customer {
        firstName
        defaultEmailAddress {
          emailAddress
        }
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
      line?.sellingPlanId === config.serumSellingPlanId ||
      line?.sellingPlanId === config.rootRevival4WeekSellingPlanId ||
      line?.sellingPlanId === config.rootRevival6WeekSellingPlanId ||
      line?.sellingPlanId === config.rootRevival8WeekSellingPlanId,
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
  let futureReservationVariantIds: string[] = [];
  let rootRevivalIntervalWeeks: 4 | 6 | 8 | null = null;

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

    // Future deliveries repeat only the five haircare products.
    // The scalp massager belongs to the initial delivery only.
    futureReservationVariantIds = [...variantIds];

    if (config.massagerVariantId) {
      variantIds.push(config.massagerVariantId);
    }
  } else if (
    [
      config.rootRevival4WeekSellingPlanId,
      config.rootRevival6WeekSellingPlanId,
      config.rootRevival8WeekSellingPlanId,
    ].some((id) => id && sellingPlanIds.has(id))
  ) {
    planType = ROOT_REVIVAL.code;

    if (
      config.rootRevival4WeekSellingPlanId &&
      sellingPlanIds.has(config.rootRevival4WeekSellingPlanId)
    ) {
      rootRevivalIntervalWeeks = 4;
    } else if (
      config.rootRevival6WeekSellingPlanId &&
      sellingPlanIds.has(config.rootRevival6WeekSellingPlanId)
    ) {
      rootRevivalIntervalWeeks = 6;
    } else if (
      config.rootRevival8WeekSellingPlanId &&
      sellingPlanIds.has(config.rootRevival8WeekSellingPlanId)
    ) {
      rootRevivalIntervalWeeks = 8;
    }

    variantIds = [
      requireValue(config.serumVariantId, "serumVariantId"),
      requireValue(config.shampooVariantId, "shampooVariantId"),
      requireValue(config.conditionerVariantId, "conditionerVariantId"),
    ];

    futureReservationVariantIds = [...variantIds];
  } else if (
    config.serumSellingPlanId &&
    sellingPlanIds.has(config.serumSellingPlanId)
  ) {
    planType = SERUM.code;

    // Serum Ritual subscription only.
    // One-time Serum product purchases never create a subscription
    // contract, so they never enter this path. Shopify's native
    // inventory flow decrements available stock for those orders.
    //
    // For SERUM_RITUAL_90, Shopify already consumed the first unit on
    // checkout, so the app must not manually deduct again.
    variantIds = [];

    // Hold aside the two remaining Serum units for payment #2 and #3.
    futureReservationVariantIds = [
      requireValue(config.serumVariantId, "serumVariantId"),
    ];
  } else {
    console.error(
      `Ignoring unknown subscription plan for contract ${contractId}`,
    );

    return new Response();
  }

  const customerId =
    webhook.admin_graphql_api_customer_id ?? null;

  const shopifyNextBillingAt = contract.nextBillingDate
    ? new Date(contract.nextBillingDate)
    : null;

  const acceleratedRenewalMinutes = Number(
    process.env.LUSHKA_ACCELERATED_RENEWAL_MINUTES ?? "0",
  );

  const acceleratedTestCustomerId =
    process.env.LUSHKA_ACCELERATED_TEST_CUSTOMER_ID?.trim() ?? "";

  const acceleratedRenewalEnabled =
    acceleratedTestCustomerId.length > 0 &&
    customerId === acceleratedTestCustomerId &&
    Number.isFinite(acceleratedRenewalMinutes) &&
    acceleratedRenewalMinutes > 0;

  const nextBillingAt = acceleratedRenewalEnabled
    ? new Date(
        Date.now() +
          acceleratedRenewalMinutes * 60 * 1000,
      )
    : shopifyNextBillingAt;

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

  if (
    (planType === COMPLETE.code ||
      planType === ROOT_REVIVAL.code ||
      planType === SERUM.code) &&
    futureReservationVariantIds.length > 0
  ) {
    const unitsPerVariant =
      (planType === ROOT_REVIVAL.code
        ? ROOT_REVIVAL.maxCycles
        : planType === SERUM.code
          ? SERUM.maxCycles
          : COMPLETE.maxCycles) - 1;

    const reservationResult =
      await reserveCompleteFutureInventory({
        graphql: admin.graphql,
        shop,
        contractId,
        planType,
        locationId: config.locationId,
        variantIds: futureReservationVariantIds,
        unitsPerVariant,
      });

    console.log(
      `Future inventory reservation reconciled for ${contractId}`,
      reservationResult,
    );
  }

  const lifecycleRecipient =
    contract.customer?.defaultEmailAddress
      ?.emailAddress?.trim();

  if (
    lifecycleRecipient &&
    planType === ROOT_REVIVAL.code
  ) {
    if (!rootRevivalIntervalWeeks) {
      throw new Error(
        `Unable to determine Root Revival interval for contract ${contractId}`,
      );
    }

    const lifecycleStartedAt =
      contract.createdAt
        ? new Date(contract.createdAt)
        : new Date();

    const lifecycleResult =
      await scheduleRootRevivalLifecycleEmails({
        shop,
        contractId,
        recipientEmail: lifecycleRecipient,
        startedAt: lifecycleStartedAt,
        intervalWeeks: rootRevivalIntervalWeeks,
      });

    console.log(
      `Root Revival lifecycle emails scheduled for ${contractId}`,
      lifecycleResult,
    );
  } else if (lifecycleRecipient) {
    const lifecycleStartedAt =
      contract.createdAt
        ? new Date(contract.createdAt)
        : new Date();

    const lifecycleResult =
      await scheduleLifecycleEmails({
        shop,
        contractId,
        recipientEmail: lifecycleRecipient,
        startedAt: lifecycleStartedAt,
      });

    console.log(
      `Lifecycle emails scheduled for ${contractId}`,
      lifecycleResult,
    );
  } else {
    console.warn(
      `Lifecycle emails not scheduled because customer email is unavailable for ${contractId}`,
    );
  }

  return new Response();
};
