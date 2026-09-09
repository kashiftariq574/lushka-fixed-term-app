import type { ReviewOrder } from "./review-order.server";

export type ReviewEmailEligibility =
  | {
      eligible: true;
      recipientEmail: string;
      customerName: string | null;
    }
  | {
      eligible: false;
      reason: string;
    };

export function validateReviewEmailEligibility({
  order,
  readyTag,
  requireMarketingSubscription,
}: {
  order: ReviewOrder;
  readyTag: string;
  requireMarketingSubscription: boolean;
}): ReviewEmailEligibility {
  /*
   * Re-check that the exact READY signal still exists.
   *
   * This protects against processing a stale webhook after another
   * process has already consumed/removed the signal.
   */
  if (!order.tags.includes(readyTag)) {
    return {
      eligible: false,
      reason: `READY tag is no longer present: ${readyTag}`,
    };
  }

  if (
    String(order.displayFulfillmentStatus).toUpperCase() !==
    "FULFILLED"
  ) {
    return {
      eligible: false,
      reason: `Order is not fully fulfilled: ${order.displayFulfillmentStatus}`,
    };
  }

  if (order.cancelledAt) {
    return {
      eligible: false,
      reason: "Order has been cancelled",
    };
  }

  const financialStatus = String(
    order.displayFinancialStatus ?? "",
  ).toUpperCase();

  if (
    financialStatus === "REFUNDED" ||
    financialStatus === "PARTIALLY_REFUNDED"
  ) {
    return {
      eligible: false,
      reason: `Order financial status is ${financialStatus}`,
    };
  }

  if (
    String(order.returnStatus).toUpperCase() !==
    "NO_RETURN"
  ) {
    return {
      eligible: false,
      reason: `Order return status is ${order.returnStatus}`,
    };
  }

  const customer = order.customer;
  const defaultEmail = customer?.defaultEmailAddress;

  /*
   * Prefer the customer's current Shopify email address.
   *
   * For reward emails we can fall back to the email stored on the
   * exact order if the current customer email object is unavailable.
   */
  const recipientEmail =
    defaultEmail?.emailAddress?.trim() ||
    order.email?.trim() ||
    "";

  if (!recipientEmail) {
    return {
      eligible: false,
      reason: "No recipient email is available",
    };
  }

  /*
   * Review-request emails are marketing messages and must only be
   * sent when the current Shopify marketing state is SUBSCRIBED.
   *
   * Reward-delivery emails can call this function with
   * requireMarketingSubscription=false. Their final classification
   * remains separate from the request-email logic.
   */
  if (requireMarketingSubscription) {
    if (!defaultEmail) {
      return {
        eligible: false,
        reason:
          "Customer default email marketing state is unavailable",
      };
    }

    const marketingState = String(
      defaultEmail.marketingState ?? "",
    ).toUpperCase();

    if (marketingState !== "SUBSCRIBED") {
      return {
        eligible: false,
        reason: `Customer marketing state is ${marketingState || "UNKNOWN"}`,
      };
    }

    if (
      !defaultEmail.marketingUnsubscribeUrl?.trim()
    ) {
      return {
        eligible: false,
        reason:
          "Customer marketing unsubscribe URL is unavailable",
      };
    }
  }

  const firstName = customer?.firstName?.trim() || null;

  return {
    eligible: true,
    recipientEmail,
    customerName: firstName,
  };
}
