import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { SERUM } from "../domain/subscription-policy";
import { restoreSerumReservedInventoryAfterFailedBilling } from "../services/serum-inventory-reservation.server";

const SERUM_RELEASED_STATUSES = [
  "INVENTORY_RELEASED",
  "PENDING",
  "SUBMITTED",
  "CHALLENGED",
] as const;

function cycleFromBillingKey(
  key: string,
  contractId: string,
): number | null {
  const prefix = `lushka:${contractId}:cycle:`;

  if (!key.startsWith(prefix)) {
    return null;
  }

  const remainder = key.slice(prefix.length);
  const cyclePart = remainder.split(":")[0];
  const cycleIndex = Number(cyclePart);

  if (!Number.isInteger(cycleIndex) || cycleIndex < 1) {
    return null;
  }

  return cycleIndex;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop } =
    await authenticate.webhook(request);

  const billingKey = payload?.idempotency_key as string | undefined;
  const contractId =
    payload?.admin_graphql_api_subscription_contract_id as
      | string
      | undefined;
  const errorMessage = payload?.error_message as string | null | undefined;
  const errorCode = payload?.error_code as string | null | undefined;

  if (!billingKey || !contractId) {
    console.error("Invalid subscription billing failure payload", {
      shop,
      billingKey,
      contractId,
    });

    return new Response(null, { status: 200 });
  }

  const error = [errorCode, errorMessage].filter(Boolean).join(": ");

  const attempt = await prisma.billingAttempt.findUnique({
    where: {
      idempotencyKey: billingKey,
    },
  });

  if (attempt?.status === "FAILED") {
    console.log(
      `Ignoring duplicate billing failure for ${billingKey}`,
    );

    return new Response(null, { status: 200 });
  }

  if (attempt?.status === "SUCCESS") {
    console.log(
      `Ignoring billing failure after SUCCESS for ${billingKey}`,
    );

    return new Response(null, { status: 200 });
  }

  const contractState = await prisma.contractState.findUnique({
    where: {
      contractId,
    },
  });

  if (
    contractState?.planType === SERUM.code &&
    attempt &&
    SERUM_RELEASED_STATUSES.includes(
      attempt.status as (typeof SERUM_RELEASED_STATUSES)[number],
    )
  ) {
    const cycleIndex =
      attempt.cycleIndex ??
      cycleFromBillingKey(billingKey, contractId);

    if (!cycleIndex) {
      console.error(
        "Unable to resolve Serum billing cycle for failure restore",
        { billingKey, contractId },
      );

      return new Response(null, { status: 200 });
    }

    const config = await prisma.shopConfig.findUnique({
      where: {
        shop,
      },
    });

    if (!config?.serumVariantId || !admin) {
      console.error(
        "Unable to restore Serum reservation after billing failure",
        {
          shop,
          contractId,
          hasAdmin: Boolean(admin),
          hasSerumVariant: Boolean(config?.serumVariantId),
        },
      );

      return new Response(null, { status: 500 });
    }

    try {
      await restoreSerumReservedInventoryAfterFailedBilling({
        graphql: admin.graphql,
        contractId,
        serumVariantId: config.serumVariantId,
        cycleIndex,
      });
    } catch (restoreError) {
      console.error(
        `Failed to restore Serum reservation for ${contractId}`,
        restoreError,
      );

      await prisma.inventoryReservation.updateMany({
        where: {
          contractId,
          variantId: config.serumVariantId,
        },
        data: {
          status: "RECOVERY_REQUIRED",
        },
      });

      return new Response(null, { status: 500 });
    }
  }

  await prisma.billingAttempt.updateMany({
    where: {
      idempotencyKey: billingKey,
      status: {
        not: "SUCCESS",
      },
    },
    data: {
      status: "FAILED",
      error: error || "Subscription billing attempt failed",
    },
  });

  await prisma.contractState.updateMany({
    where: {
      contractId,
      status: {
        in: ["ACTIVE", "CHALLENGED"],
      },
    },
    data: {
      status: "ACTIVE",
      failedAt: new Date(),
    },
  });

  console.error("Subscription billing attempt failed", {
    shop,
    contractId,
    billingKey,
    errorCode,
    errorMessage,
  });

  return new Response(null, { status: 200 });
};
