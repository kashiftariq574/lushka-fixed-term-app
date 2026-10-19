import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { COMPLETE, ROOT_REVIVAL, SERUM } from "../domain/subscription-policy";
import {
  releaseCompleteRemainingInventory,
} from "../services/program-inventory-release.server";
import { releaseSerumRemainingInventory } from "../services/serum-inventory-reservation.server";
import { authenticate } from "../shopify.server";

type ContractUpdatePayload = {
  admin_graphql_api_id?: string;
};

type ContractStatusResponse = {
  data?: {
    subscriptionContract?: {
      id?: string;
      status?: string | null;
      nextBillingDate?: string | null;
    } | null;
  };
  errors?: unknown[];
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

function completeVariantIds(config: {
  serumVariantId?: string | null;
  shampooVariantId?: string | null;
  conditionerVariantId?: string | null;
  maskVariantId?: string | null;
  oilVariantId?: string | null;
}): string[] {
  const variantIds = [
    config.serumVariantId,
    config.shampooVariantId,
    config.conditionerVariantId,
    config.maskVariantId,
    config.oilVariantId,
  ];

  if (variantIds.some((id) => !id)) {
    throw new Error(
      "Complete programme inventory configuration is incomplete",
    );
  }

  return variantIds as string[];
}

function rootRevivalVariantIds(config: {
  serumVariantId?: string | null;
  shampooVariantId?: string | null;
  conditionerVariantId?: string | null;
}): string[] {
  const variantIds = [
    config.serumVariantId,
    config.shampooVariantId,
    config.conditionerVariantId,
  ];

  if (variantIds.some((id) => !id)) {
    throw new Error(
      "Root Revival programme inventory configuration is incomplete",
    );
  }

  return variantIds as string[];
}

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

  const json = (await response.json()) as ContractStatusResponse;

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
    try {
      if (localState.planType === COMPLETE.code) {
        const config = await db.shopConfig.findUnique({
          where: {
            shop,
          },
        });

        if (!config) {
          throw new Error(
            "Complete programme inventory configuration is incomplete",
          );
        }

        await releaseCompleteRemainingInventory({
          graphql: admin.graphql,
          contractId,
          variantIds: completeVariantIds(config),
          reason: "contract-terminal",
        });
      } else if (localState.planType === ROOT_REVIVAL.code) {
        const config = await db.shopConfig.findUnique({
          where: {
            shop,
          },
        });

        if (!config) {
          throw new Error(
            "Root Revival programme inventory configuration is incomplete",
          );
        }

        await releaseCompleteRemainingInventory({
          graphql: admin.graphql,
          contractId,
          variantIds: rootRevivalVariantIds(config),
          reason: "contract-terminal",
        });
      } else if (localState.planType === SERUM.code) {
        const config = await db.shopConfig.findUnique({
          where: {
            shop,
          },
        });

        if (!config?.serumVariantId) {
          throw new Error(
            "Serum inventory configuration is incomplete",
          );
        }

        await releaseSerumRemainingInventory({
          graphql: admin.graphql,
          contractId,
          serumVariantId: config.serumVariantId,
          reason: "contract-terminal",
        });
      } else {
        throw new Error(
          `Unsupported subscription plan type: ${localState.planType}`,
        );
      }
    } catch (error) {
      console.error(
        `Failed to release terminal programme inventory for ${contractId}`,
        error,
      );

      return new Response(
        "Unable to release terminal programme inventory",
        { status: 500 },
      );
    }

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
