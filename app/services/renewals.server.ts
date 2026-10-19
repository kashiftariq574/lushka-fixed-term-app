import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  createBillingAttempt,
  isBillingAttemptDefinitiveError,
  isBillingAttemptUncertainError,
} from "./billing.server";
import {
  deterministicBillingKey,
  retryBillingKey,
  SERUM,
} from "../domain/subscription-policy";

import {
  hasReachedMaxAttempts,
  isRetryReady,
} from "../domain/renewal-retry-policy";
import {
  prepareSerumReservedInventoryForBilling,
  restoreSerumReservedInventoryAfterFailedBilling,
} from "./serum-inventory-reservation.server";

const OPEN_BILLING_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "CHALLENGED",
] as const;

const SERUM_RESUME_STATUSES = [
  "PREPARING",
  "INVENTORY_RELEASED",
] as const;

export async function processDueRenewals(now = new Date()) {
  const dueContracts = await prisma.contractState.findMany({
    where: {
      status: "ACTIVE",
      nextBillingAt: {
        lte: now,
      },
      successfulCycleCount: {
        lt: 3,
      },
    },
    orderBy: {
      nextBillingAt: "asc",
    },
  });

  const results: Array<Record<string, unknown>> = [];

  for (const contractState of dueContracts) {
    const cycleIndex = contractState.successfulCycleCount;

    if (cycleIndex < 1 || cycleIndex > 2) {
      results.push({
        contractId: contractState.contractId,
        skipped: true,
        reason: `Invalid renewal cycle index ${cycleIndex}`,
      });
      continue;
    }

    const attempts = await prisma.billingAttempt.findMany({
      where: {
        contractId: contractState.contractId,
        cycleIndex,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const existingSuccess = attempts.find(
      (attempt) => attempt.status === "SUCCESS",
    );

    if (existingSuccess) {
      results.push({
        contractId: contractState.contractId,
        cycleIndex,
        skipped: true,
        reason: "Billing attempt already succeeded",
      });
      continue;
    }

    const latestAttempt = attempts[0];

    if (
      latestAttempt &&
      OPEN_BILLING_STATUSES.includes(
        latestAttempt.status as (typeof OPEN_BILLING_STATUSES)[number],
      )
    ) {
      results.push({
        contractId: contractState.contractId,
        cycleIndex,
        skipped: true,
        reason: `Existing billing attempt status: ${latestAttempt.status}`,
      });
      continue;
    }

    if (latestAttempt?.status === "FAILED") {
      if (hasReachedMaxAttempts(attempts.length)) {
        const paymentHoldUntil = new Date(
          now.getTime() + 72 * 60 * 60 * 1000,
        );

        const holdUpdate =
          await prisma.contractState.updateMany({
            where: {
              id: contractState.id,
              status: "ACTIVE",
            },
            data: {
              status: "PAYMENT_HOLD",
              paymentHoldStartedAt: now,
              paymentHoldUntil,
            },
          });

        results.push({
          contractId: contractState.contractId,
          cycleIndex,
          skipped: true,
          reason:
            holdUpdate.count > 0
              ? "Payment moved to 72-hour hold after maximum attempts"
              : "Payment hold already applied by another worker",
        });

        continue;
      }

      if (!isRetryReady(latestAttempt.updatedAt, now)) {
        results.push({
          contractId: contractState.contractId,
          cycleIndex,
          skipped: true,
          reason: "Waiting 5 minutes before retrying failed payment",
        });
        continue;
      }
    }

    const isSerum = contractState.planType === SERUM.code;

    let attemptRecord =
      latestAttempt &&
      isSerum &&
      SERUM_RESUME_STATUSES.includes(
        latestAttempt.status as (typeof SERUM_RESUME_STATUSES)[number],
      )
        ? latestAttempt
        : null;

    if (!attemptRecord) {
      const attemptNumber = attempts.length + 1;

      const idempotencyKey =
        attemptNumber === 1
          ? deterministicBillingKey(
              contractState.contractId,
              cycleIndex,
            )
          : retryBillingKey(
              contractState.contractId,
              cycleIndex,
              attemptNumber - 1,
            );

      try {
        attemptRecord = await prisma.billingAttempt.create({
          data: {
            contractStateId: contractState.id,
            contractId: contractState.contractId,
            cycleIndex,
            idempotencyKey,
            status: isSerum ? "PREPARING" : "PENDING",
            attemptCount: attemptNumber,
          },
        });
      } catch (error) {
        const prismaCode =
          typeof error === "object" &&
          error !== null &&
          "code" in error
            ? String((error as { code?: unknown }).code)
            : null;

        if (prismaCode === "P2002") {
          results.push({
            contractId: contractState.contractId,
            cycleIndex,
            skipped: true,
            reason: "Concurrent billing attempt already created",
          });
          continue;
        }

        throw error;
      }
    }

    let inventoryReleasedForSerum =
      attemptRecord.status === "INVENTORY_RELEASED";

    try {
      const { admin } = await unauthenticated.admin(
        contractState.shop,
      );

      if (isSerum && attemptRecord.status === "PREPARING") {
        const config = await prisma.shopConfig.findUnique({
          where: {
            shop: contractState.shop,
          },
        });

        if (!config?.serumVariantId) {
          throw new Error(
            "Serum inventory configuration is incomplete",
          );
        }

        await prepareSerumReservedInventoryForBilling({
          graphql: admin.graphql,
          contractId: contractState.contractId,
          serumVariantId: config.serumVariantId,
          cycleIndex,
        });

        const releasedUpdate =
          await prisma.billingAttempt.updateMany({
            where: {
              id: attemptRecord.id,
              status: "PREPARING",
            },
            data: {
              status: "INVENTORY_RELEASED",
            },
          });

        if (releasedUpdate.count === 0) {
          results.push({
            contractId: contractState.contractId,
            cycleIndex,
            skipped: true,
            reason:
              "Serum billing attempt left PREPARING concurrently",
          });
          continue;
        }

        inventoryReleasedForSerum = true;
        attemptRecord = {
          ...attemptRecord,
          status: "INVENTORY_RELEASED",
        };
      }

      const { attempt } = await createBillingAttempt(
        admin.graphql,
        contractState.contractId,
        cycleIndex,
        attemptRecord.idempotencyKey,
      );

      await prisma.billingAttempt.updateMany({
        where: {
          id: attemptRecord.id,
          status: {
            not: "SUCCESS",
          },
        },
        data: {
          shopifyBillingAttemptId: attempt?.id ?? null,
          shopifyOrderId: attempt?.order?.id ?? null,
          status: attempt?.ready ? "SUBMITTED" : "PENDING",
          error: attempt?.errorMessage ?? null,
        },
      });

      results.push({
        contractId: contractState.contractId,
        cycleIndex,
        submitted: true,
        billingAttemptId: attempt?.id ?? null,
        ready: attempt?.ready ?? null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown billing error";

      const definitive = isBillingAttemptDefinitiveError(error);
      const uncertain =
        isBillingAttemptUncertainError(error) ||
        (isSerum &&
          inventoryReleasedForSerum &&
          !definitive);

      if (isSerum && inventoryReleasedForSerum && uncertain) {
        /*
         * Mutation may already have been accepted by Shopify.
         * Keep the released Serum unit and the same BillingAttempt
         * so the worker can resume with the identical idempotency key.
         */
        await prisma.billingAttempt.updateMany({
          where: {
            id: attemptRecord.id,
            status: {
              in: ["INVENTORY_RELEASED", "PREPARING"],
            },
          },
          data: {
            status: "INVENTORY_RELEASED",
            error: message,
          },
        });

        results.push({
          contractId: contractState.contractId,
          cycleIndex,
          submitted: false,
          uncertain: true,
          error: message,
        });
        continue;
      }

      if (isSerum && inventoryReleasedForSerum && definitive) {
        try {
          const config = await prisma.shopConfig.findUnique({
            where: {
              shop: contractState.shop,
            },
          });

          if (!config?.serumVariantId) {
            throw new Error(
              "Serum inventory configuration is incomplete",
            );
          }

          const { admin } = await unauthenticated.admin(
            contractState.shop,
          );

          await restoreSerumReservedInventoryAfterFailedBilling({
            graphql: admin.graphql,
            contractId: contractState.contractId,
            serumVariantId: config.serumVariantId,
            cycleIndex,
          });
        } catch (restoreError) {
          console.error(
            `Failed to restore Serum reservation after billing error for ${contractState.contractId}`,
            restoreError,
          );

          await prisma.inventoryReservation.updateMany({
            where: {
              contractId: contractState.contractId,
            },
            data: {
              status: "RECOVERY_REQUIRED",
            },
          });
        }
      }

      const failureUpdate = await prisma.billingAttempt.updateMany({
        where: {
          id: attemptRecord.id,
          status: {
            not: "SUCCESS",
          },
        },
        data: {
          status: "FAILED",
          error: message,
        },
      });

      if (failureUpdate.count > 0) {
        await prisma.contractState.update({
          where: {
            id: contractState.id,
          },
          data: {
            retryCount: {
              increment: 1,
            },
            failedAt: new Date(),
          },
        });
      }

      results.push({
        contractId: contractState.contractId,
        cycleIndex,
        submitted: false,
        error: message,
      });
    }
  }

  return {
    checkedAt: now.toISOString(),
    dueCount: dueContracts.length,
    results,
  };
}
