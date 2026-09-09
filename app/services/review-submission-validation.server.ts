import type { ReviewOrder } from "./review-order.server";

export type ReviewSubmissionValidation =
  | {
      valid: true;
      matchedProductLabel: string;
    }
  | {
      valid: false;
      reason: string;
    };

function normalizeBasic(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOrderNumber(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^order\s*/i, "")
    .replace(/^#/, "")
    .replace(/\s+/g, "");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const PRODUCT_STOP_WORDS = new Set([
  "lushka",
  "the",
  "a",
  "an",
  "and",
  "with",
  "for",
  "of",
]);

function meaningfulTokens(value: string): string[] {
  return normalizeBasic(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !PRODUCT_STOP_WORDS.has(token));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();

    if (!trimmed) {
      continue;
    }

    const key = normalizeBasic(trimmed);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function orderProductLabels(order: ReviewOrder): string[] {
  const labels: Array<string | null | undefined> = [];

  for (const lineItem of order.lineItems) {
    labels.push(
      lineItem.name,
      lineItem.product?.title,
      lineItem.lineItemGroup?.title,
    );

    /*
     * A variant title can be useful when a product is sold using
     * meaningful variants, but Shopify often returns "Default Title".
     * Do not treat that generic value as a reviewable product name.
     */
    if (
      lineItem.variant?.title &&
      normalizeBasic(lineItem.variant.title) !== "default title"
    ) {
      labels.push(
        `${lineItem.product?.title ?? lineItem.name} ${lineItem.variant.title}`,
      );
    }
  }

  return uniqueStrings(labels);
}

function productLabelMatches(
  submittedProduct: string,
  candidate: string,
): boolean {
  const submittedNormalized =
    normalizeBasic(submittedProduct);

  const candidateNormalized =
    normalizeBasic(candidate);

  if (
    !submittedNormalized ||
    !candidateNormalized
  ) {
    return false;
  }

  /*
   * Exact normalized title:
   *
   * "Lushka Multi-Peptide Hair Growth Serum"
   * matches the same title regardless of punctuation/case.
   */
  if (submittedNormalized === candidateNormalized) {
    return true;
  }

  /*
   * Allow descriptive shortened names:
   *
   * "Multi Peptide Hair Growth Serum"
   * can match
   * "Lushka Multi-Peptide Hair Growth Serum".
   */
  if (
    submittedNormalized.length >= 6 &&
    candidateNormalized.includes(
      submittedNormalized,
    )
  ) {
    return true;
  }

  const submittedTokens =
    meaningfulTokens(submittedProduct);

  const candidateTokens =
    new Set(meaningfulTokens(candidate));

  if (submittedTokens.length === 0) {
    return false;
  }

  /*
   * Every meaningful submitted token must exist in the candidate.
   *
   * We normally require at least two meaningful tokens so a generic
   * value such as "serum", "oil" or "mask" cannot accidentally match
   * the wrong item in a multi-product order.
   *
   * A one-token value is handled separately below only when it
   * uniquely identifies one order item.
   */
  return submittedTokens.every(
    (token) => candidateTokens.has(token),
  );
}

function findMatchingProductLabels(
  order: ReviewOrder,
  submittedProduct: string,
): string[] {
  const labels = orderProductLabels(order);

  const matches = labels.filter((label) =>
    productLabelMatches(
      submittedProduct,
      label,
    ),
  );

  return uniqueStrings(matches);
}

function submittedTokenCount(
  submittedProduct: string,
): number {
  return meaningfulTokens(
    submittedProduct,
  ).length;
}

export function validateReviewSubmissionAgainstOrder({
  order,
  submittedOrderNumber,
  submittedEmail,
  submittedProduct,
}: {
  order: ReviewOrder;
  submittedOrderNumber: string | null;
  submittedEmail: string | null;
  submittedProduct: string | null;
}): ReviewSubmissionValidation {
  if (!submittedOrderNumber) {
    return {
      valid: false,
      reason: "Form submission is missing order number",
    };
  }

  if (
    normalizeOrderNumber(submittedOrderNumber) !==
    normalizeOrderNumber(order.name)
  ) {
    return {
      valid: false,
      reason:
        "Submitted order number does not match the exact Shopify order",
    };
  }

  if (!submittedEmail) {
    return {
      valid: false,
      reason: "Form submission is missing email",
    };
  }

  const validOrderEmails = uniqueStrings([
    order.email,
    order.customer?.defaultEmailAddress
      ?.emailAddress,
  ]).map(normalizeEmail);

  if (
    !validOrderEmails.includes(
      normalizeEmail(submittedEmail),
    )
  ) {
    return {
      valid: false,
      reason:
        "Submitted email does not belong to the exact Shopify order/customer",
    };
  }

  if (!submittedProduct) {
    return {
      valid: false,
      reason: "Form submission is missing product",
    };
  }

  const matches = findMatchingProductLabels(
    order,
    submittedProduct,
  );

  if (matches.length === 0) {
    return {
      valid: false,
      reason:
        "Submitted product does not match any product or bundle in the exact Shopify order",
    };
  }

  /*
   * Generic one-word input is acceptable only when it resolves to
   * exactly one possible order product/bundle.
   *
   * Example:
   * Order contains only Multi-Peptide Hair Growth Serum.
   * Customer types "serum".
   *
   * But if several order items could match the same generic word,
   * reject it as ambiguous.
   */
  if (
    submittedTokenCount(submittedProduct) === 1 &&
    matches.length !== 1
  ) {
    return {
      valid: false,
      reason:
        "Submitted product name is too ambiguous for this order",
    };
  }

  return {
    valid: true,
    matchedProductLabel: matches[0],
  };
}
