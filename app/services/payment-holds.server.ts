import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  COMPLETE,
  ROOT_REVIVAL,
  SERUM,
} from "../domain/subscription-policy";
import {
  releaseCompleteRemainingInventory,
} from "./program-inventory-release.server";
import { releaseSerumRemainingInventory } from "./serum-inventory-reservation.server";

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

export async function processExpiredPaymentHolds(
  now = new Date(),
) {
  const expiredHolds =
    await db.contractState.findMany({
      where: {
        status: "PAYMENT_HOLD",
        paymentHoldUntil: {
          lte: now,
        },
      },
      orderBy: {
        paymentHoldUntil: "asc",
      },
    });

  const results: Array<Record<string, unknown>> = [];

  for (const contract of expiredHolds) {
    try {
      if (contract.planType === COMPLETE.code) {
        const config = await db.shopConfig.findUnique({
          where: {
            shop: contract.shop,
          },
        });

        if (!config) {
          throw new Error(
            "Complete programme inventory configuration is incomplete",
          );
        }

        const variantIds =
          completeVariantIds(config);

        const { admin } =
          await unauthenticated.admin(contract.shop);

        await releaseCompleteRemainingInventory({
          graphql: admin.graphql,
          contractId: contract.contractId,
          variantIds,
          reason: "payment-hold-expiry",
        });
      } else if (contract.planType === ROOT_REVIVAL.code) {
        const config = await db.shopConfig.findUnique({
          where: {
            shop: contract.shop,
          },
        });

        if (!config) {
          throw new Error(
            "Root Revival programme inventory configuration is incomplete",
          );
        }

        const variantIds =
          rootRevivalVariantIds(config);

        const { admin } =
          await unauthenticated.admin(contract.shop);

        await releaseCompleteRemainingInventory({
          graphql: admin.graphql,
          contractId: contract.contractId,
          variantIds,
          reason: "payment-hold-expiry",
        });
      } else if (contract.planType === SERUM.code) {
        const config = await db.shopConfig.findUnique({
          where: {
            shop: contract.shop,
          },
        });

        if (!config?.serumVariantId) {
          throw new Error(
            "Serum inventory configuration is incomplete",
          );
        }

        const { admin } =
          await unauthenticated.admin(contract.shop);

        await releaseSerumRemainingInventory({
          graphql: admin.graphql,
          contractId: contract.contractId,
          serumVariantId: config.serumVariantId,
          reason: "payment-hold-expiry",
        });
      } else {
        throw new Error(
          `Unsupported subscription plan type: ${contract.planType}`,
        );
      }

      const expired =
        await db.contractState.updateMany({
          where: {
            id: contract.id,
            status: "PAYMENT_HOLD",
            paymentHoldUntil: {
              lte: now,
            },
          },
          data: {
            status: "PAYMENT_HOLD_EXPIRED",
            nextBillingAt: null,
          },
        });

      results.push({
        contractId: contract.contractId,
        expired: expired.count > 0,
        ...(expired.count === 0
          ? {
              reason:
                "Payment hold already processed by another worker",
            }
          : {}),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown payment-hold expiry error";

      console.error(
        `Failed to expire payment hold for ${contract.contractId}`,
        error,
      );

      results.push({
        contractId: contract.contractId,
        expired: false,
        error: message,
      });
    }
  }

  return {
    checkedAt: now.toISOString(),
    dueCount: expiredHolds.length,
    results,
  };
}
