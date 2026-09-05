import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { createBillingAttempt } from "./billing.server";
import { deterministicBillingKey } from "../domain/subscription-policy";

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

    const idempotencyKey = deterministicBillingKey(
      contractState.contractId,
      cycleIndex,
    );

    const existingAttempt = await prisma.billingAttempt.findUnique({
      where: {
        contractId_cycleIndex: {
          contractId: contractState.contractId,
          cycleIndex,
        },
      },
    });

    if (existingAttempt?.status === "SUCCESS") {
      results.push({
        contractId: contractState.contractId,
        cycleIndex,
        skipped: true,
        reason: "Billing attempt already succeeded",
      });
      continue;
    }

    const attemptRecord = await prisma.billingAttempt.upsert({
      where: {
        contractId_cycleIndex: {
          contractId: contractState.contractId,
          cycleIndex,
        },
      },
      create: {
        contractStateId: contractState.id,
        contractId: contractState.contractId,
        cycleIndex,
        idempotencyKey,
        status: "PENDING",
        attemptCount: 1,
      },
      update: {
        status: "PENDING",
        attemptCount: {
          increment: 1,
        },
        error: null,
      },
    });

    try {
      const { admin } = await unauthenticated.admin(contractState.shop);

      const { attempt } = await createBillingAttempt(
        admin.graphql,
        contractState.contractId,
        cycleIndex,
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
        error instanceof Error ? error.message : "Unknown billing error";

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
