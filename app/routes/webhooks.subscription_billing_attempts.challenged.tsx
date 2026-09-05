import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);

  const billingKey = payload?.idempotency_key as string | undefined;
  const contractId =
    payload?.admin_graphql_api_subscription_contract_id as string | undefined;

  if (!billingKey || !contractId) {
    console.error("Invalid subscription billing challenged payload", {
      shop,
      billingKey,
      contractId,
    });

    return new Response(null, { status: 200 });
  }

  await prisma.billingAttempt.updateMany({
    where: {
      idempotencyKey: billingKey,
      status: {
        not: "SUCCESS",
      },
    },
    data: {
      status: "CHALLENGED",
      error: "Customer payment authentication required",
    },
  });

  console.warn("Subscription billing attempt challenged", {
    shop,
    contractId,
    billingKey,
  });

  return new Response(null, { status: 200 });
};
