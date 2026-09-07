import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

type ContractUpdatePayload = {
  admin_graphql_api_id?: string;
};

const CONTRACT_STATUS_QUERY = `#graphql
  query ContractStatus($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      nextBillingDate
    }
  }
`;

const TERMINAL_STATUSES = new Set([
  "CANCELLED",
  "EXPIRED",
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    return new Response("Admin API unavailable", { status: 500 });
  }

  const webhook = payload as ContractUpdatePayload;
  const contractId = webhook.admin_graphql_api_id;

  if (!contractId) {
    console.error("Invalid subscription contract update payload", {
      shop,
      topic,
    });

    return new Response(null, { status: 200 });
  }

  const localState = await db.contractState.findUnique({
    where: {
      contractId,
    },
  });

  if (!localState) {
    console.warn(
      `Ignoring contract update without local ContractState: ${contractId}`,
    );

    return new Response(null, { status: 200 });
  }

  // Our fixed-term app owns completion after exactly 3 successful payments.
  // Never allow a later Shopify update to revive a completed contract.
  if (localState.status === "COMPLETED") {
    console.log(
      `Ignoring contract status update for completed contract ${contractId}`,
    );

    return new Response(null, { status: 200 });
  }

  const response = await admin.graphql(CONTRACT_STATUS_QUERY, {
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
      status: 500,
    });
  }

  const shopifyStatus = String(contract.status ?? "").toUpperCase();

  const nextBillingAt = contract.nextBillingDate
    ? new Date(contract.nextBillingDate)
    : null;

  if (shopifyStatus === "PAUSED") {
    await db.contractState.update({
      where: {
        contractId,
      },
      data: {
        status: "PAUSED",
        nextBillingAt,
      },
    });

    return new Response(null, { status: 200 });
  }

  if (shopifyStatus === "FAILED") {
    await db.contractState.update({
      where: {
        contractId,
      },
      data: {
        status: "FAILED",
        nextBillingAt: null,
        failedAt: new Date(),
      },
    });

    return new Response(null, { status: 200 });
  }

  if (TERMINAL_STATUSES.has(shopifyStatus)) {
    await db.contractState.update({
      where: {
        contractId,
      },
      data: {
        status: shopifyStatus,
        nextBillingAt: null,
      },
    });

    return new Response(null, { status: 200 });
  }

  if (
    shopifyStatus === "ACTIVE" &&
    ["PAUSED", "FAILED"].includes(localState.status)
  ) {
    await db.contractState.update({
      where: {
        contractId,
      },
      data: {
        status: "ACTIVE",
        nextBillingAt,
        failedAt: null,
      },
    });

    return new Response(null, { status: 200 });
  }

  console.log(
    `No local status change required for contract ${contractId}: ` +
      `${localState.status} -> ${shopifyStatus}`,
  );

  return new Response(null, { status: 200 });
};
