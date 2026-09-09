import { Prisma } from "@prisma/client";

import db from "../db.server";

export type ReviewSignalType =
  | "DAY_14_REVIEW_REQUEST"
  | "DAY_28_PHOTOS_ONLY_REQUEST"
  | "DAY_28_REVIEW_PHOTOS_REQUEST"
  | "DAY_14_REVIEW_REWARD"
  | "DAY_28_REVIEW_PHOTOS_REWARD"
  | "DAY_28_PHOTOS_ONLY_REWARD";

export type ReviewSignalClaim =
  | {
      claimed: true;
      eventId: string;
      signalKey: string;
      attemptCount: number;
      reclaimedStaleLease: boolean;
      discountCode: string | null;
      providerMessageId: string | null;
      emailSentAt: Date | null;
    }
  | {
      claimed: false;
      eventId: string;
      signalKey: string;
      reason:
        | "ALREADY_PROCESSING"
        | "ALREADY_COMPLETED"
        | "ALREADY_REJECTED"
        | "CLAIM_RACE_LOST";
    };

const DEFAULT_PROCESSING_LEASE_MS =
  10 * 60 * 1000;

export function buildReviewSignalKey({
  shop,
  orderId,
  signalType,
  metaobjectHandle,
}: {
  shop: string;
  orderId: string;
  signalType: ReviewSignalType;
  metaobjectHandle?: string | null;
}): string {
  const logicalSignalType =
    signalType === "DAY_28_PHOTOS_ONLY_REQUEST" ||
    signalType === "DAY_28_REVIEW_PHOTOS_REQUEST"
      ? "DAY_28_REVIEW_REQUEST"
      : signalType;

  return [
    shop.trim().toLowerCase(),
    orderId,
    logicalSignalType,
    metaobjectHandle?.trim() || "-",
  ].join("|");
}

export function buildReviewRewardKey({
  shop,
  orderId,
  signalType,
}: {
  shop: string;
  orderId: string;
  signalType: ReviewSignalType;
}): string {
  let stage: "DAY_14" | "DAY_28";

  switch (signalType) {
    case "DAY_14_REVIEW_REWARD":
      stage = "DAY_14";
      break;

    case "DAY_28_REVIEW_PHOTOS_REWARD":
    case "DAY_28_PHOTOS_ONLY_REWARD":
      stage = "DAY_28";
      break;

    default:
      throw new Error(
        `Review signal is not a reward signal: ${signalType}`,
      );
  }

  return [
    shop.trim().toLowerCase(),
    orderId,
    "REWARD",
    stage,
  ].join("|");
}

function isUniqueConstraintError(
  error: unknown,
): boolean {
  return (
    error instanceof
      Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function claimReviewRewardGrant({
  eventId,
  attemptCount,
  rewardKey,
}: {
  eventId: string;
  attemptCount: number;
  rewardKey: string;
}): Promise<
  | {
      claimed: true;
      rewardKey: string;
    }
  | {
      claimed: false;
      rewardKey: string;
      reason: "ALREADY_GRANTED";
    }
> {
  try {
    const result =
      await db.reviewSignalEvent.updateMany({
        where: {
          id: eventId,
          status: "PROCESSING",
          attemptCount,
          OR: [
            {
              rewardKey: null,
            },
            {
              rewardKey,
            },
          ],
        },
        data: {
          rewardKey,
        },
      });

    if (result.count === 0) {
      throw new Error(
        `Review signal lease lost while claiming reward: ${eventId}, attempt ${attemptCount}`,
      );
    }

    return {
      claimed: true,
      rewardKey,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        claimed: false,
        rewardKey,
        reason: "ALREADY_GRANTED",
      };
    }

    throw error;
  }
}

export async function claimReviewSignal({
  shop,
  orderId,
  signalType,
  readyTag,
  metaobjectHandle,
  leaseMs = DEFAULT_PROCESSING_LEASE_MS,
}: {
  shop: string;
  orderId: string;
  signalType: ReviewSignalType;
  readyTag: string;
  metaobjectHandle?: string | null;
  leaseMs?: number;
}): Promise<ReviewSignalClaim> {
  const signalKey = buildReviewSignalKey({
    shop,
    orderId,
    signalType,
    metaobjectHandle,
  });

  const now = new Date();

  /*
   * Fast path:
   *
   * The first worker creates the unique logical signal directly in
   * PROCESSING state. Concurrent workers attempting the same
   * signalKey will receive P2002 and inspect the existing record.
   */
  try {
    const created =
      await db.reviewSignalEvent.create({
        data: {
          shop,
          orderId,
          signalType,
          readyTag,
          signalKey,
          metaobjectHandle:
            metaobjectHandle?.trim() || null,
          status: "PROCESSING",
          attemptCount: 1,
          processingStartedAt: now,
        },
      });

    return {
      claimed: true,
      eventId: created.id,
      signalKey,
      attemptCount: created.attemptCount,
      reclaimedStaleLease: false,
      discountCode: created.discountCode,
      providerMessageId:
        created.providerMessageId,
      emailSentAt: created.emailSentAt,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const existing =
    await db.reviewSignalEvent.findUnique({
      where: {
        signalKey,
      },
    });

  if (!existing) {
    /*
     * Extremely unlikely race/infrastructure state. Do not create a
     * second logical action blindly.
     */
    throw new Error(
      `Review signal exists by unique constraint but could not be read: ${signalKey}`,
    );
  }

  if (existing.status === "COMPLETED") {
    return {
      claimed: false,
      eventId: existing.id,
      signalKey,
      reason: "ALREADY_COMPLETED",
    };
  }

  if (existing.status === "REJECTED") {
    return {
      claimed: false,
      eventId: existing.id,
      signalKey,
      reason: "ALREADY_REJECTED",
    };
  }

  /*
   * Normal retryable states can be claimed atomically.
   */
  if (
    existing.status === "PENDING" ||
    existing.status === "RETRYABLE"
  ) {
    const claimed =
      await db.reviewSignalEvent.updateMany({
        where: {
          id: existing.id,
          status: {
            in: ["PENDING", "RETRYABLE"],
          },
        },
        data: {
          status: "PROCESSING",
          processingStartedAt: now,
          attemptCount: {
            increment: 1,
          },
          lastError: null,
        },
      });

    if (claimed.count === 0) {
      return {
        claimed: false,
        eventId: existing.id,
        signalKey,
        reason: "CLAIM_RACE_LOST",
      };
    }

    const refreshed =
      await db.reviewSignalEvent.findUniqueOrThrow({
        where: {
          id: existing.id,
        },
      });

    return {
      claimed: true,
      eventId: refreshed.id,
      signalKey,
      attemptCount: refreshed.attemptCount,
      reclaimedStaleLease: false,
      discountCode: refreshed.discountCode,
      providerMessageId:
        refreshed.providerMessageId,
      emailSentAt: refreshed.emailSentAt,
    };
  }

  if (existing.status === "PROCESSING") {
    const staleBefore = new Date(
      now.getTime() - leaseMs,
    );

    /*
     * Only one worker may reclaim a stale PROCESSING lease.
     *
     * processingStartedAt=null is also treated as stale because a
     * PROCESSING record without a lease timestamp cannot safely be
     * considered actively owned.
     */
    const reclaimed =
      await db.reviewSignalEvent.updateMany({
        where: {
          id: existing.id,
          status: "PROCESSING",
          OR: [
            {
              processingStartedAt: null,
            },
            {
              processingStartedAt: {
                lte: staleBefore,
              },
            },
          ],
        },
        data: {
          processingStartedAt: now,
          attemptCount: {
            increment: 1,
          },
          lastError: null,
        },
      });

    if (reclaimed.count === 0) {
      return {
        claimed: false,
        eventId: existing.id,
        signalKey,
        reason: "ALREADY_PROCESSING",
      };
    }

    const refreshed =
      await db.reviewSignalEvent.findUniqueOrThrow({
        where: {
          id: existing.id,
        },
      });

    return {
      claimed: true,
      eventId: refreshed.id,
      signalKey,
      attemptCount: refreshed.attemptCount,
      reclaimedStaleLease: true,
      discountCode: refreshed.discountCode,
      providerMessageId:
        refreshed.providerMessageId,
      emailSentAt: refreshed.emailSentAt,
    };
  }

  throw new Error(
    `Unsupported ReviewSignalEvent status: ${existing.status}`,
  );
}

function assertLeaseMutationSucceeded({
  count,
  eventId,
  attemptCount,
  operation,
}: {
  count: number;
  eventId: string;
  attemptCount: number;
  operation: string;
}) {
  if (count === 0) {
    throw new Error(
      `Review signal lease lost while ${operation}: ${eventId}, attempt ${attemptCount}`,
    );
  }
}

export async function markReviewSignalRetryable({
  eventId,
  attemptCount,
  error,
}: {
  eventId: string;
  attemptCount: number;
  error: string;
}) {
  const result =
    await db.reviewSignalEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        attemptCount,
      },
      data: {
        status: "RETRYABLE",
        processingStartedAt: null,
        lastError: error,
      },
    });

  assertLeaseMutationSucceeded({
    count: result.count,
    eventId,
    attemptCount,
    operation:
      "marking review signal retryable",
  });
}

export async function markReviewSignalRejected({
  eventId,
  attemptCount,
  reason,
}: {
  eventId: string;
  attemptCount: number;
  reason: string;
}) {
  const now = new Date();

  const result =
    await db.reviewSignalEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        attemptCount,
      },
      data: {
        status: "REJECTED",
        processingStartedAt: null,
        lastError: reason,
        processedAt: now,
      },
    });

  assertLeaseMutationSucceeded({
    count: result.count,
    eventId,
    attemptCount,
    operation:
      "rejecting review signal",
  });
}

export async function markReviewSignalCompleted({
  eventId,
  attemptCount,
}: {
  eventId: string;
  attemptCount: number;
}) {
  const now = new Date();

  const result =
    await db.reviewSignalEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        attemptCount,
      },
      data: {
        status: "COMPLETED",
        processingStartedAt: null,
        lastError: null,
        processedAt: now,
      },
    });

  assertLeaseMutationSucceeded({
    count: result.count,
    eventId,
    attemptCount,
    operation:
      "completing review signal",
  });
}

export async function saveReviewSignalDiscount({
  eventId,
  attemptCount,
  discountCode,
}: {
  eventId: string;
  attemptCount: number;
  discountCode: string;
}) {
  const result =
    await db.reviewSignalEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        attemptCount,
      },
      data: {
        discountCode,
      },
    });

  assertLeaseMutationSucceeded({
    count: result.count,
    eventId,
    attemptCount,
    operation:
      "saving review discount",
  });
}

export async function saveReviewSignalEmailSent({
  eventId,
  attemptCount,
  providerMessageId,
}: {
  eventId: string;
  attemptCount: number;
  providerMessageId: string | null;
}) {
  const result =
    await db.reviewSignalEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        attemptCount,
      },
      data: {
        providerMessageId,
        emailSentAt: new Date(),
      },
    });

  assertLeaseMutationSucceeded({
    count: result.count,
    eventId,
    attemptCount,
    operation:
      "saving review email delivery",
  });
}
