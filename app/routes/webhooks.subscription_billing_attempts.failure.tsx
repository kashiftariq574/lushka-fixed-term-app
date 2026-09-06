import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);

  const billingKey = payload?.idempotency_key as string | undefined;
  const contractId =
    payload?.admin_graphql_api_subscription_contract_id as string | undefined;
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
