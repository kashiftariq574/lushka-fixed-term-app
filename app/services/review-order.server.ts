type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

export type ReviewOrderLineItem = {
  id: string;
  name: string;
  quantity: number;
  image: {
    url: string;
    altText?: string | null;
  } | null;
  product: {
    id: string;
    title: string;
  } | null;
  variant: {
    id: string;
    title: string;
  } | null;
  lineItemGroup: {
    id: string;
    title: string;
    quantity: number;
    productId?: string | null;
    variantId?: string | null;
  } | null;
};

export type ReviewOrder = {
  id: string;
  name: string;
  email?: string | null;

  day14ReviewBridge: {
    handle: string | null;
    email: string | null;
    orderNumber: string | null;
    product: string | null;
    review: string | null;
  };

  day28ReviewBridge: {
    handle: string | null;
    email: string | null;
    orderNumber: string | null;
    product: string | null;
    review: string | null;
    photo1: string | null;
    ownershipConsent: string | null;
  };

  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus: string;
  returnStatus: string;

  tags: string[];

  customer: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;

    defaultEmailAddress: {
      emailAddress: string;
      marketingState: string;
      marketingUnsubscribeUrl: string;
    } | null;
  } | null;

  lineItems: ReviewOrderLineItem[];
};

type OrderQueryResponse = {
  data?: {
    order?: {
      id: string;
      name: string;
      email?: string | null;

      day14Handle?: {
        value?: string | null;
      } | null;
      day14Email?: {
        value?: string | null;
      } | null;
      day14OrderNumber?: {
        value?: string | null;
      } | null;
      day14Product?: {
        value?: string | null;
      } | null;
      day14Review?: {
        value?: string | null;
      } | null;

      day28Handle?: {
        value?: string | null;
      } | null;
      day28Email?: {
        value?: string | null;
      } | null;
      day28OrderNumber?: {
        value?: string | null;
      } | null;
      day28Product?: {
        value?: string | null;
      } | null;
      day28Review?: {
        value?: string | null;
      } | null;
      day28Photo1?: {
        value?: string | null;
      } | null;
      day28OwnershipConsent?: {
        value?: string | null;
      } | null;

      cancelledAt?: string | null;
      displayFinancialStatus?: string | null;
      displayFulfillmentStatus: string;
      returnStatus: string;

      tags: string[];

      customer?: {
        id: string;
        firstName?: string | null;
        lastName?: string | null;

        defaultEmailAddress?: {
          emailAddress: string;
          marketingState: string;
          marketingUnsubscribeUrl: string;
        } | null;
      } | null;

      lineItems: {
        nodes: ReviewOrderLineItem[];
      };
    } | null;
  };

  errors?: Array<{
    message?: string;
  }>;
};

const REVIEW_ORDER_QUERY = `#graphql
  query ReviewOrder($id: ID!) {
    order(id: $id) {
      id
      name
      email

      day14Handle: metafield(
        namespace: "lushka_review"
        key: "day14_handle"
      ) {
        value
      }

      day14Email: metafield(
        namespace: "lushka_review"
        key: "day14_email"
      ) {
        value
      }

      day14OrderNumber: metafield(
        namespace: "lushka_review"
        key: "day14_order_number"
      ) {
        value
      }

      day14Product: metafield(
        namespace: "lushka_review"
        key: "day14_product"
      ) {
        value
      }

      day14Review: metafield(
        namespace: "lushka_review"
        key: "day14_review"
      ) {
        value
      }

      day28Handle: metafield(
        namespace: "lushka_review"
        key: "day28_handle"
      ) {
        value
      }

      day28Email: metafield(
        namespace: "lushka_review"
        key: "day28_email"
      ) {
        value
      }

      day28OrderNumber: metafield(
        namespace: "lushka_review"
        key: "day28_order_number"
      ) {
        value
      }

      day28Product: metafield(
        namespace: "lushka_review"
        key: "day28_product"
      ) {
        value
      }

      day28Review: metafield(
        namespace: "lushka_review"
        key: "day28_review"
      ) {
        value
      }

      day28Photo1: metafield(
        namespace: "lushka_review"
        key: "day28_photo1"
      ) {
        value
      }

      day28OwnershipConsent: metafield(
        namespace: "lushka_review"
        key: "day28_ownership_consent"
      ) {
        value
      }

      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      returnStatus

      tags

      customer {
        id
        firstName
        lastName

        defaultEmailAddress {
          emailAddress
          marketingState
          marketingUnsubscribeUrl
        }
      }

      lineItems(first: 100) {
        nodes {
          id
          name
          quantity

          image {
            url
            altText
          }

          product {
            id
            title
          }

          variant {
            id
            title
          }

          lineItemGroup {
            id
            title
            quantity
            productId
            variantId
          }
        }
      }
    }
  }
`;

export async function getReviewOrder({
  graphql,
  orderId,
}: {
  graphql: AdminGraphql;
  orderId: string;
}): Promise<ReviewOrder> {
  const response = await graphql(REVIEW_ORDER_QUERY, {
    variables: {
      id: orderId,
    },
  });

  const json = (await response.json()) as OrderQueryResponse;

  if (json.errors?.length) {
    const message = json.errors
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ");

    throw new Error(
      `Unable to read review order ${orderId}: ${
        message || "Shopify GraphQL error"
      }`,
    );
  }

  const order = json.data?.order;

  if (!order) {
    throw new Error(
      `Review order not found: ${orderId}`,
    );
  }

  return {
    id: order.id,
    name: order.name,
    email: order.email ?? null,

    day14ReviewBridge: {
      handle:
        order.day14Handle?.value?.trim() ||
        null,
      email:
        order.day14Email?.value?.trim() ||
        null,
      orderNumber:
        order.day14OrderNumber?.value?.trim() ||
        null,
      product:
        order.day14Product?.value?.trim() ||
        null,
      review:
        order.day14Review?.value?.trim() ||
        null,
    },

    day28ReviewBridge: {
      handle:
        order.day28Handle?.value?.trim() ||
        null,
      email:
        order.day28Email?.value?.trim() ||
        null,
      orderNumber:
        order.day28OrderNumber?.value?.trim() ||
        null,
      product:
        order.day28Product?.value?.trim() ||
        null,
      review:
        order.day28Review?.value?.trim() ||
        null,
      photo1:
        order.day28Photo1?.value?.trim() ||
        null,
      ownershipConsent:
        order.day28OwnershipConsent?.value?.trim() ||
        null,
    },

    cancelledAt: order.cancelledAt ?? null,
    displayFinancialStatus:
      order.displayFinancialStatus ?? null,
    displayFulfillmentStatus:
      order.displayFulfillmentStatus,
    returnStatus: order.returnStatus,

    tags: order.tags,

    customer: order.customer
      ? {
          id: order.customer.id,
          firstName:
            order.customer.firstName ?? null,
          lastName:
            order.customer.lastName ?? null,

          defaultEmailAddress:
            order.customer.defaultEmailAddress
              ? {
                  emailAddress:
                    order.customer.defaultEmailAddress
                      .emailAddress,
                  marketingState:
                    order.customer.defaultEmailAddress
                      .marketingState,
                  marketingUnsubscribeUrl:
                    order.customer.defaultEmailAddress
                      .marketingUnsubscribeUrl,
                }
              : null,
        }
      : null,

    lineItems: order.lineItems.nodes,
  };
}
