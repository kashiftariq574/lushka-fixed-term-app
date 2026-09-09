import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getReviewOrder } from "../services/review-order.server";
import { validateReviewEmailEligibility } from "../services/review-email-eligibility.server";
import {
  findReviewFormDefinition,
  getReviewFormSubmission,
  reviewFormFieldValue,
} from "../services/review-form-submission.server";
import { validateReviewSubmissionAgainstOrder } from "../services/review-submission-validation.server";
import { validateReviewFormContent } from "../services/review-form-content-validation.server";
import {
  buildReviewRewardKey,
  claimReviewRewardGrant,
  claimReviewSignal,
  markReviewSignalCompleted,
  markReviewSignalRejected,
  markReviewSignalRetryable,
  saveReviewSignalDiscount,
  saveReviewSignalEmailSent,
} from "../services/review-signal-idempotency.server";
import { createOrGetReviewRewardDiscount } from "../services/review-discount.server";
import {
  reviewOrderEmailProductLabels,
  reviewStorefrontUrl,
} from "../services/review-order-email-context.server";
import {
  type ReviewEmailType,
  sendReviewEmail,
} from "../services/review-email.server";
import {
  removeReviewOrderTags,
  transitionReviewOrderTags,
} from "../services/review-order-tags.server";
import { reviewSignalFinalState } from "../services/review-signal-state.server";

type OrderUpdatedPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  tags?: string | string[];
};

type ReadySignal =
  | {
      type: "DAY_14_REVIEW_REQUEST";
      tag: string;
    }
  | {
      type: "DAY_28_PHOTOS_ONLY_REQUEST";
      tag: string;
    }
  | {
      type: "DAY_28_REVIEW_PHOTOS_REQUEST";
      tag: string;
    }
  | {
      type: "DAY_14_REVIEW_REWARD";
      tag: string;
      metaobjectHandle: string;
    }
  | {
      type: "DAY_28_REVIEW_PHOTOS_REWARD";
      tag: string;
      metaobjectHandle: string;
    }
  | {
      type: "DAY_28_PHOTOS_ONLY_REWARD";
      tag: string;
      metaobjectHandle: string;
    };

const DAY_14_REVIEW_REQUEST =
  "lushka-app-14-review-request-ready";

const DAY_28_PHOTOS_ONLY_REQUEST =
  "lushka-app-28-photos-only-request-ready";

const DAY_28_REVIEW_PHOTOS_REQUEST =
  "lushka-app-28-review-photos-request-ready";

const DAY_14_REVIEW_REWARD_PREFIX =
  "lushka-app-14-review-ready-";

const DAY_28_REVIEW_PHOTOS_REWARD_PREFIX =
  "lushka-app-28-review-photos-ready-";

const DAY_28_PHOTOS_ONLY_REWARD_PREFIX =
  "lushka-app-28-photos-only-ready-";

function reviewEmailTypeForSignal(
  signal: ReadySignal,
): ReviewEmailType {
  switch (signal.type) {
    case "DAY_14_REVIEW_REQUEST":
      return "DAY_14_REVIEW_REQUEST";

    case "DAY_28_REVIEW_PHOTOS_REQUEST":
      return "DAY_28_REVIEW_PHOTOS_REQUEST";

    case "DAY_28_PHOTOS_ONLY_REQUEST":
      return "DAY_28_PHOTOS_ONLY_REQUEST";

    case "DAY_14_REVIEW_REWARD":
      return "DAY_14_REVIEW_REWARD";

    case "DAY_28_REVIEW_PHOTOS_REWARD":
    case "DAY_28_PHOTOS_ONLY_REWARD":
      return "DAY_28_REVIEW_REWARD";
  }
}

function reviewRewardConfig(
  signal: ReadySignal,
): {
  percentage: 10 | 20;
  expiresInDays: number | null;
} | null {
  switch (signal.type) {
    case "DAY_14_REVIEW_REWARD":
      return {
        percentage: 10,
        expiresInDays: null,
      };

    case "DAY_28_REVIEW_PHOTOS_REWARD":
    case "DAY_28_PHOTOS_ONLY_REWARD":
      return {
        percentage: 20,
        expiresInDays: 30,
      };

    default:
      return null;
  }
}

function reviewFormNameForSignal(
  signal: ReadySignal,
): string | null {
  switch (signal.type) {
    case "DAY_14_REVIEW_REWARD":
      return "Lushka – 14 Day Review";

    case "DAY_28_REVIEW_PHOTOS_REWARD":
      return "Lushka – 28 Day Review + Photos";

    case "DAY_28_PHOTOS_ONLY_REWARD":
      return "Lushka – 28 Day Photos Only";

    default:
      return null;
  }
}

function normaliseTags(tags: string | string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  if (Array.isArray(tags)) {
    return tags
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function signalFromTag(tag: string): ReadySignal | null {
  if (tag === DAY_14_REVIEW_REQUEST) {
    return {
      type: "DAY_14_REVIEW_REQUEST",
      tag,
    };
  }

  if (tag === DAY_28_PHOTOS_ONLY_REQUEST) {
    return {
      type: "DAY_28_PHOTOS_ONLY_REQUEST",
      tag,
    };
  }

  if (tag === DAY_28_REVIEW_PHOTOS_REQUEST) {
    return {
      type: "DAY_28_REVIEW_PHOTOS_REQUEST",
      tag,
    };
  }

  if (tag.startsWith(DAY_14_REVIEW_REWARD_PREFIX)) {
    const metaobjectHandle = tag.slice(
      DAY_14_REVIEW_REWARD_PREFIX.length,
    );

    if (!metaobjectHandle) {
      return null;
    }

    return {
      type: "DAY_14_REVIEW_REWARD",
      tag,
      metaobjectHandle,
    };
  }

  if (tag.startsWith(DAY_28_REVIEW_PHOTOS_REWARD_PREFIX)) {
    const metaobjectHandle = tag.slice(
      DAY_28_REVIEW_PHOTOS_REWARD_PREFIX.length,
    );

    if (!metaobjectHandle) {
      return null;
    }

    return {
      type: "DAY_28_REVIEW_PHOTOS_REWARD",
      tag,
      metaobjectHandle,
    };
  }

  if (tag.startsWith(DAY_28_PHOTOS_ONLY_REWARD_PREFIX)) {
    const metaobjectHandle = tag.slice(
      DAY_28_PHOTOS_ONLY_REWARD_PREFIX.length,
    );

    if (!metaobjectHandle) {
      return null;
    }

    return {
      type: "DAY_28_PHOTOS_ONLY_REWARD",
      tag,
      metaobjectHandle,
    };
  }

  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const webhook = payload as OrderUpdatedPayload;

  const orderId =
    webhook.admin_graphql_api_id ??
    (webhook.id
      ? `gid://shopify/Order/${webhook.id}`
      : null);

  if (!orderId) {
    console.warn("Ignoring order update without order id", {
      shop,
      topic,
    });

    return new Response(null, { status: 200 });
  }

  const tags = normaliseTags(webhook.tags);

  const readySignals = tags
    .map(signalFromTag)
    .filter(
      (signal): signal is ReadySignal =>
        signal !== null,
    );

  if (readySignals.length === 0) {
    console.log(
      `No Lushka review email READY signal on ${orderId}`,
    );

    return new Response(null, { status: 200 });
  }

  if (!admin) {
    console.error(
      `Admin API unavailable while processing review email signals for ${orderId}`,
    );

    return new Response(
      "Admin API unavailable",
      { status: 500 },
    );
  }

  let order;

  try {
    order = await getReviewOrder({
      graphql: admin.graphql,
      orderId,
    });
  } catch (error) {
    console.error(
      `Unable to fetch exact review order ${orderId}`,
      error,
    );

    return new Response(
      "Unable to fetch review order",
      { status: 500 },
    );
  }

  console.log("Fetched exact Lushka review order", {
    shop,
    orderId: order.id,
    orderName: order.name,
    lineItemCount: order.lineItems.length,
    customerId: order.customer?.id ?? null,
    marketingState:
      order.customer?.defaultEmailAddress?.marketingState ??
      null,
  });

  for (const signal of readySignals) {
    console.log("Detected Lushka review email READY signal", {
      shop,
      orderId,
      orderName: webhook.name ?? null,
      signalType: signal.type,
      signalTag: signal.tag,
      metaobjectHandle:
        "metaobjectHandle" in signal
          ? signal.metaobjectHandle
          : null,
    });

    let claim: Awaited<
      ReturnType<typeof claimReviewSignal>
    >;

    try {
      claim = await claimReviewSignal({
        shop,
        orderId: order.id,
        signalType: signal.type,
        readyTag: signal.tag,
        metaobjectHandle:
          "metaobjectHandle" in signal
            ? signal.metaobjectHandle
            : null,
      });
    } catch (error) {
      console.error(
        "Unable to claim Lushka review signal",
        {
          shop,
          orderId: order.id,
          signalType: signal.type,
          signalTag: signal.tag,
          error,
        },
      );

      return new Response(
        "Unable to claim review signal",
        { status: 500 },
      );
    }

    if (!claim.claimed) {
      console.log(
        "Skipping already claimed Lushka review signal",
        {
          shop,
          orderId: order.id,
          signalType: signal.type,
          signalTag: signal.tag,
          reason: claim.reason,
        },
      );

      /*
       * A previous attempt may have finished the durable DB state
       * but failed while cleaning Shopify tags.
       *
       * Reconcile that final Shopify state without repeating email
       * or discount side effects.
       */
      if (claim.reason === "ALREADY_COMPLETED") {
        try {
          const finalState =
            reviewSignalFinalState(
              signal.type,
            );

          await transitionReviewOrderTags({
            graphql: admin.graphql,
            orderId: order.id,
            readyTag: signal.tag,
            finalTags:
              finalState.successTags,
          });
        } catch (error) {
          console.error(
            "Unable to reconcile completed Lushka review signal tags",
            {
              shop,
              orderId: order.id,
              signalType: signal.type,
              error,
            },
          );

          return new Response(
            "Unable to reconcile review signal tags",
            { status: 500 },
          );
        }
      }

      if (claim.reason === "ALREADY_REJECTED") {
        try {
          await removeReviewOrderTags({
            graphql: admin.graphql,
            orderId: order.id,
            tags: [signal.tag],
          });
        } catch (error) {
          console.error(
            "Unable to clean rejected Lushka review READY tag",
            {
              shop,
              orderId: order.id,
              signalType: signal.type,
              error,
            },
          );

          return new Response(
            "Unable to clean rejected review signal",
            { status: 500 },
          );
        }
      }

      continue;
    }

    console.log("Claimed Lushka review signal", {
      shop,
      orderId: order.id,
      signalType: signal.type,
      attemptCount: claim.attemptCount,
      reclaimedStaleLease:
        claim.reclaimedStaleLease,
    });

    const isRequestEmail =
      signal.type === "DAY_14_REVIEW_REQUEST" ||
      signal.type === "DAY_28_PHOTOS_ONLY_REQUEST" ||
      signal.type === "DAY_28_REVIEW_PHOTOS_REQUEST";

    const eligibility = validateReviewEmailEligibility({
      order,
      readyTag: signal.tag,
      requireMarketingSubscription: isRequestEmail,
    });

    if (!eligibility.eligible) {
      console.log("Skipping ineligible Lushka review email signal", {
        shop,
        orderId: order.id,
        orderName: order.name,
        signalType: signal.type,
        signalTag: signal.tag,
        reason: eligibility.reason,
      });

      await markReviewSignalRejected({
        eventId: claim.eventId,

        attemptCount: claim.attemptCount,
        reason: eligibility.reason,
      });

      try {
        await removeReviewOrderTags({
          graphql: admin.graphql,
          orderId: order.id,
          tags: [signal.tag],
        });
      } catch (error) {
        console.error(
          "Unable to remove rejected Lushka review READY tag",
          {
            shop,
            orderId: order.id,
            signalType: signal.type,
            error,
          },
        );

        return new Response(
          "Unable to clean rejected review signal",
          { status: 500 },
        );
      }

      continue;
    }

    console.log("Lushka review email signal is eligible", {
      shop,
      orderId: order.id,
      orderName: order.name,
      signalType: signal.type,
      signalTag: signal.tag,
      hasRecipientEmail: Boolean(
        eligibility.recipientEmail,
      ),
      customerName: eligibility.customerName,
      requireMarketingSubscription: isRequestEmail,
    });

    const reviewFormName =
      reviewFormNameForSignal(signal);

    if (
      reviewFormName &&
      "metaobjectHandle" in signal
    ) {
      try {
        const definition =
          await findReviewFormDefinition({
            graphql: admin.graphql,
            name: reviewFormName,
          });

        const submission =
          await getReviewFormSubmission({
            graphql: admin.graphql,
            type: definition.type,
            handle: signal.metaobjectHandle,
          });

        const submittedEmail =
          reviewFormFieldValue(submission, [
            "Email",
            "Email address",
          ]);

        const submittedOrderNumber =
          reviewFormFieldValue(submission, [
            "Order number",
            "Order Number",
            "Order #",
          ]);

        const submittedProduct =
          reviewFormFieldValue(submission, [
            "Product",
            "Product name",
          ]);

        console.log(
          "Fetched exact Lushka review form submission",
          {
            shop,
            orderId: order.id,
            orderName: order.name,
            signalType: signal.type,
            formName: reviewFormName,
            metaobjectType: definition.type,
            metaobjectHandle:
              signal.metaobjectHandle,
            fieldKeys:
              submission.fields.map(
                (field) => field.key,
              ),
            hasEmail: Boolean(submittedEmail),
            hasOrderNumber:
              Boolean(submittedOrderNumber),
            hasProduct:
              Boolean(submittedProduct),
          },
        );

        const submissionValidation =
          validateReviewSubmissionAgainstOrder({
            order,
            submittedOrderNumber,
            submittedEmail,
            submittedProduct,
          });

        if (!submissionValidation.valid) {
          console.warn(
            "Rejecting invalid Lushka review form submission",
            {
              shop,
              orderId: order.id,
              orderName: order.name,
              signalType: signal.type,
              metaobjectHandle:
                signal.metaobjectHandle,
              reason:
                submissionValidation.reason,
            },
          );

          await markReviewSignalRejected({
            eventId: claim.eventId,

            attemptCount: claim.attemptCount,
            reason: submissionValidation.reason,
          });

          try {
            await removeReviewOrderTags({
              graphql: admin.graphql,
              orderId: order.id,
              tags: [signal.tag],
            });
          } catch (error) {
            console.error(
              "Unable to remove invalid-submission READY tag",
              {
                shop,
                orderId: order.id,
                signalType: signal.type,
                error,
              },
            );

            return new Response(
              "Unable to clean invalid review submission",
              { status: 500 },
            );
          }

          continue;
        }

        const contentValidation =
          validateReviewFormContent({
            signalType: signal.type,
            submission,
          });

        if (!contentValidation.valid) {
          console.warn(
            "Rejecting incomplete Lushka review form submission",
            {
              shop,
              orderId: order.id,
              orderName: order.name,
              signalType: signal.type,
              metaobjectHandle:
                signal.metaobjectHandle,
              reason:
                contentValidation.reason,
            },
          );

          await markReviewSignalRejected({
            eventId: claim.eventId,

            attemptCount: claim.attemptCount,
            reason: contentValidation.reason,
          });

          try {
            await removeReviewOrderTags({
              graphql: admin.graphql,
              orderId: order.id,
              tags: [signal.tag],
            });
          } catch (error) {
            console.error(
              "Unable to remove incomplete-submission READY tag",
              {
                shop,
                orderId: order.id,
                signalType: signal.type,
                error,
              },
            );

            return new Response(
              "Unable to clean incomplete review submission",
              { status: 500 },
            );
          }

          continue;
        }

        const rewardKey =
          buildReviewRewardKey({
            shop,
            orderId: order.id,
            signalType: signal.type,
          });

        const rewardGrant =
          await claimReviewRewardGrant({
            eventId: claim.eventId,
            attemptCount: claim.attemptCount,
            rewardKey,
          });

        if (!rewardGrant.claimed) {
          const duplicateReason =
            "Reward already granted for this order and review stage";

          console.warn(
            "Rejecting duplicate Lushka review reward",
            {
              shop,
              orderId: order.id,
              orderName: order.name,
              signalType: signal.type,
              metaobjectHandle:
                signal.metaobjectHandle,
              rewardKey,
            },
          );

          await markReviewSignalRejected({
            eventId: claim.eventId,
            attemptCount: claim.attemptCount,
            reason: duplicateReason,
          });

          try {
            await removeReviewOrderTags({
              graphql: admin.graphql,
              orderId: order.id,
              tags: [signal.tag],
            });
          } catch (error) {
            console.error(
              "Unable to remove duplicate-reward READY tag",
              {
                shop,
                orderId: order.id,
                signalType: signal.type,
                error,
              },
            );

            return new Response(
              "Unable to clean duplicate reward signal",
              { status: 500 },
            );
          }

          continue;
        }

        console.log(
          "Lushka review form submission matches exact order and required content",
          {
            shop,
            orderId: order.id,
            orderName: order.name,
            signalType: signal.type,
            metaobjectHandle:
              signal.metaobjectHandle,
            matchedProductLabel:
              submissionValidation.matchedProductLabel,
          },
        );
      } catch (error) {
        console.error(
          "Unable to fetch Lushka review form submission",
          {
            shop,
            orderId: order.id,
            orderName: order.name,
            signalType: signal.type,
            metaobjectHandle:
              signal.metaobjectHandle,
            error,
          },
        );

        await markReviewSignalRetryable({
          eventId: claim.eventId,

          attemptCount: claim.attemptCount,
          error:
            error instanceof Error
              ? error.message
              : "Unable to fetch review form submission",
        });

        return new Response(
          "Unable to fetch review form submission",
          { status: 500 },
        );
      }
    }

    const rewardConfig =
      reviewRewardConfig(signal);

    let discountCode:
      | string
      | null = claim.discountCode;

    let discountEndsAt:
      | Date
      | null = null;

    /*
     * Reward emails require their deterministic Shopify discount.
     *
     * If email has already been persisted as sent, do not recreate
     * or re-fetch reward side effects just to reconcile final tags.
     */
    if (
      rewardConfig &&
      !claim.emailSentAt
    ) {
      try {
        const discount =
          await createOrGetReviewRewardDiscount({
            graphql: admin.graphql,
            signalKey: claim.signalKey,
            customerId:
              order.customer?.id ?? null,
            percentage:
              rewardConfig.percentage,
            expiresInDays:
              rewardConfig.expiresInDays,
          });

        discountCode = discount.code;
        discountEndsAt =
          discount.endsAt;

        await saveReviewSignalDiscount({
          eventId: claim.eventId,

          attemptCount: claim.attemptCount,
          discountCode: discount.code,
        });

        console.log(
          "Prepared Lushka review reward discount",
          {
            shop,
            orderId: order.id,
            signalType: signal.type,
            percentage:
              discount.percentage,
            hasExpiry:
              Boolean(discount.endsAt),
            alreadyExisted:
              discount.alreadyExisted,
          },
        );
      } catch (error) {
        console.error(
          "Unable to prepare Lushka review reward discount",
          {
            shop,
            orderId: order.id,
            signalType: signal.type,
            error,
          },
        );

        await markReviewSignalRetryable({
          eventId: claim.eventId,

          attemptCount: claim.attemptCount,
          error:
            error instanceof Error
              ? error.message
              : "Unable to prepare review reward discount",
        });

        return new Response(
          "Unable to prepare review reward discount",
          { status: 500 },
        );
      }
    }

    /*
     * Deliver exactly once from our application perspective.
     *
     * emailSentAt is the durable long-term guard. Resend receives
     * the same deterministic idempotency key as an additional
     * short-term provider-side safeguard.
     */
    if (!claim.emailSentAt) {
      try {
        const productLabels =
          reviewOrderEmailProductLabels(
            order,
          );

        const emailResult =
          await sendReviewEmail({
            to:
              eligibility.recipientEmail,
            emailType:
              reviewEmailTypeForSignal(
                signal,
              ),
            customerName:
              eligibility.customerName,
            orderName:
              order.name,
            productLabels,
            storefrontUrl:
              reviewStorefrontUrl(shop),
            unsubscribeUrl:
              isRequestEmail
                ? order.customer
                    ?.defaultEmailAddress
                    ?.marketingUnsubscribeUrl ??
                  null
                : null,
            discountCode,
            discountEndsAt,
            idempotencyKey:
              `review-email:${claim.signalKey}`,
          });

        await saveReviewSignalEmailSent({
          eventId: claim.eventId,

          attemptCount: claim.attemptCount,
          providerMessageId:
            emailResult.providerMessageId,
        });

        console.log(
          "Sent Lushka review email",
          {
            shop,
            orderId: order.id,
            signalType: signal.type,
            hasProviderMessageId:
              Boolean(
                emailResult.providerMessageId,
              ),
          },
        );
      } catch (error) {
        console.error(
          "Unable to send Lushka review email",
          {
            shop,
            orderId: order.id,
            signalType: signal.type,
            error,
          },
        );

        await markReviewSignalRetryable({
          eventId: claim.eventId,

          attemptCount: claim.attemptCount,
          error:
            error instanceof Error
              ? error.message
              : "Unable to send review email",
        });

        return new Response(
          "Unable to send review email",
          { status: 500 },
        );
      }
    } else {
      console.log(
        "Lushka review email was already sent; skipping Resend",
        {
          shop,
          orderId: order.id,
          signalType: signal.type,
        },
      );
    }

    /*
     * At this point all irreversible customer-facing side effects
     * have succeeded:
     * - reward discount exists when required
     * - email delivery has been persisted
     *
     * Mark the durable event completed before Shopify tag cleanup.
     * If tag cleanup fails, a retry sees ALREADY_COMPLETED and only
     * reconciles Shopify tags without repeating email/discount work.
     */
    try {
      await markReviewSignalCompleted({
        eventId: claim.eventId,

        attemptCount: claim.attemptCount,
      });
    } catch (error) {
      console.error(
        "Unable to complete Lushka review signal event",
        {
          shop,
          orderId: order.id,
          signalType: signal.type,
          error,
        },
      );

      try {
        await markReviewSignalRetryable({
          eventId: claim.eventId,

          attemptCount: claim.attemptCount,
          error:
            error instanceof Error
              ? error.message
              : "Unable to complete review signal event",
        });
      } catch {
        // Preserve the original completion failure below.
      }

      return new Response(
        "Unable to complete review signal",
        { status: 500 },
      );
    }

    const finalState =
      reviewSignalFinalState(
        signal.type,
      );

    try {
      await transitionReviewOrderTags({
        graphql: admin.graphql,
        orderId: order.id,
        readyTag: signal.tag,
        finalTags:
          finalState.successTags,
      });
    } catch (error) {
      console.error(
        "Review email completed but Shopify tag transition failed",
        {
          shop,
          orderId: order.id,
          signalType: signal.type,
          error,
        },
      );

      /*
       * Do NOT move the DB record back to RETRYABLE here.
       *
       * Email/discount side effects already completed and the DB
       * record is intentionally COMPLETED. Shopify retry will enter
       * ALREADY_COMPLETED and reconcile tags only.
       */
      return new Response(
        "Unable to finalize review order tags",
        { status: 500 },
      );
    }

    console.log(
      "Completed Lushka review signal",
      {
        shop,
        orderId: order.id,
        signalType: signal.type,
        finalTags:
          finalState.successTags,
      },
    );
  }

  /*
   * IMPORTANT:
   *
   * Current safety pipeline:
   * - READY signal detection
   * - exact order fetch
   * - idempotent signal claim / stale lease recovery
   * - current order/customer eligibility validation
   * - exact Form metaobject fetch for reward signals
   * - order/email/product/bundle validation
   *
   * Completed pipeline:
   * - deterministic reward discount creation when required
   * - idempotent Resend email delivery
   * - persisted email delivery state
   * - durable ReviewSignalEvent completion
   * - READY -> SENT/COMPLETED Shopify tag transition
   * - completed/rejected tag reconciliation on retry
   */

  return new Response(null, { status: 200 });
};
