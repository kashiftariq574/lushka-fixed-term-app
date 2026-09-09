import { createHash } from "node:crypto";

type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

type ExistingDiscountResponse = {
  data?: {
    codeDiscountNodeByCode?: {
      id: string;
      codeDiscount: {
        __typename: string;
        title?: string;
        startsAt?: string | null;
        endsAt?: string | null;
        codes?: {
          nodes: Array<{
            code: string;
          }>;
        };
      };
    } | null;
  };
  errors?: Array<{
    message?: string;
  }>;
};

type CreateDiscountResponse = {
  data?: {
    discountCodeBasicCreate?: {
      codeDiscountNode?: {
        id: string;
        codeDiscount?: {
          __typename: string;
          title?: string;
          codes?: {
            nodes: Array<{
              code: string;
            }>;
          };
        };
      } | null;
      userErrors: Array<{
        field?: string[] | null;
        message: string;
      }>;
    };
  };
  errors?: Array<{
    message?: string;
  }>;
};

export type ReviewRewardDiscount = {
  code: string;
  discountNodeId: string;
  percentage: number;
  endsAt: Date | null;
  alreadyExisted: boolean;
};

const FIND_DISCOUNT_QUERY = `#graphql
  query ReviewRewardDiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id

      codeDiscount {
        __typename

        ... on DiscountCodeBasic {
          title
          startsAt
          endsAt

          codes(first: 1) {
            nodes {
              code
            }
          }
        }
      }
    }
  }
`;

const CREATE_DISCOUNT_MUTATION = `#graphql
  mutation CreateReviewRewardDiscount(
    $input: DiscountCodeBasicInput!
  ) {
    discountCodeBasicCreate(
      basicCodeDiscount: $input
    ) {
      codeDiscountNode {
        id

        codeDiscount {
          __typename

          ... on DiscountCodeBasic {
            title

            codes(first: 1) {
              nodes {
                code
              }
            }
          }
        }
      }

      userErrors {
        field
        message
      }
    }
  }
`;

function graphqlErrors(
  errors:
    | Array<{
        message?: string;
      }>
    | undefined,
): string | null {
  if (!errors?.length) {
    return null;
  }

  return (
    errors
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ") ||
    "Shopify GraphQL error"
  );
}

function discountSuffix(
  signalKey: string,
): string {
  return createHash("sha256")
    .update(signalKey)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
}

export function buildReviewDiscountCode({
  signalKey,
  percentage,
}: {
  signalKey: string;
  percentage: 10 | 20;
}): string {
  return `LUSHKA${percentage}-${discountSuffix(
    signalKey,
  )}`;
}

async function findExistingReviewDiscount({
  graphql,
  code,
}: {
  graphql: AdminGraphql;
  code: string;
}): Promise<{
  id: string;
  code: string;
  startsAt: Date | null;
  endsAt: Date | null;
} | null> {
  const response = await graphql(
    FIND_DISCOUNT_QUERY,
    {
      variables: {
        code,
      },
    },
  );

  const json =
    (await response.json()) as ExistingDiscountResponse;

  const errors = graphqlErrors(json.errors);

  if (errors) {
    throw new Error(
      `Unable to check review discount ${code}: ${errors}`,
    );
  }

  const node =
    json.data?.codeDiscountNodeByCode;

  if (!node) {
    return null;
  }

  if (
    node.codeDiscount.__typename !==
    "DiscountCodeBasic"
  ) {
    throw new Error(
      `Existing discount code ${code} is not a basic code discount`,
    );
  }

  const actualCode =
    node.codeDiscount.codes?.nodes[0]?.code;

  if (
    !actualCode ||
    actualCode.toUpperCase() !==
      code.toUpperCase()
  ) {
    throw new Error(
      `Existing discount lookup returned an unexpected code for ${code}`,
    );
  }

  return {
    id: node.id,
    code: actualCode,
    startsAt:
      node.codeDiscount.startsAt
        ? new Date(node.codeDiscount.startsAt)
        : null,
    endsAt:
      node.codeDiscount.endsAt
        ? new Date(node.codeDiscount.endsAt)
        : null,
  };
}

export async function createOrGetReviewRewardDiscount({
  graphql,
  signalKey,
  customerId,
  percentage,
  expiresInDays,
}: {
  graphql: AdminGraphql;
  signalKey: string;
  customerId: string | null;
  percentage: 10 | 20;
  expiresInDays: number | null;
}): Promise<ReviewRewardDiscount> {
  if (
    expiresInDays !== null &&
    (
      !Number.isInteger(expiresInDays) ||
      expiresInDays < 1
    )
  ) {
    throw new Error(
      "Review discount expiry must be a positive whole number of days",
    );
  }

  const code = buildReviewDiscountCode({
    signalKey,
    percentage,
  });

  const existing =
    await findExistingReviewDiscount({
      graphql,
      code,
    });

  /*
   * If Shopify already has this deterministic code, a previous
   * attempt may have created it successfully before the app crashed
   * or before the DB was updated. Treat it as the same logical reward.
   */
  if (existing) {
    if (
      expiresInDays !== null &&
      !existing.endsAt
    ) {
      throw new Error(
        `Existing review discount ${code} is missing its required expiry`,
      );
    }

    if (
      expiresInDays !== null &&
      existing.startsAt &&
      existing.endsAt
    ) {
      const expectedDuration =
        expiresInDays *
        24 *
        60 *
        60 *
        1000;

      const actualDuration =
        existing.endsAt.getTime() -
        existing.startsAt.getTime();

      if (
        Math.abs(
          actualDuration - expectedDuration,
        ) > 1000
      ) {
        throw new Error(
          `Existing review discount ${code} has an unexpected expiry duration`,
        );
      }
    }

    return {
      code: existing.code,
      discountNodeId: existing.id,
      percentage,
      endsAt: existing.endsAt,
      alreadyExisted: true,
    };
  }

  const startsAt = new Date();

  const endsAt =
    expiresInDays === null
      ? null
      : new Date(
          startsAt.getTime() +
            expiresInDays *
              24 *
              60 *
              60 *
              1000,
        );

  const response = await graphql(
    CREATE_DISCOUNT_MUTATION,
    {
      variables: {
        input: {
          title:
            `Lushka ${percentage}% review reward`,
          code,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt?.toISOString() ?? null,

          context: customerId?.trim()
            ? {
                customers: {
                  add: [customerId],
                },
              }
            : {
                all: "ALL",
              },

          customerGets: {
            value: {
              percentage:
                percentage / 100,
            },
            items: {
              all: true,
            },
          },

          usageLimit: 1,
          appliesOncePerCustomer: true,
        },
      },
    },
  );

  const json =
    (await response.json()) as CreateDiscountResponse;

  const errors = graphqlErrors(json.errors);

  if (errors) {
    throw new Error(
      `Unable to create review discount ${code}: ${errors}`,
    );
  }

  const result =
    json.data?.discountCodeBasicCreate;

  if (!result) {
    throw new Error(
      "Shopify discount creation response is missing",
    );
  }

  if (result.userErrors.length) {
    /*
     * Another concurrent attempt might have created the same
     * deterministic code between our lookup and mutation.
     */
    const racedExisting =
      await findExistingReviewDiscount({
        graphql,
        code,
      });

    if (racedExisting) {
      if (
        expiresInDays !== null &&
        !racedExisting.endsAt
      ) {
        throw new Error(
          `Existing raced review discount ${code} is missing its required expiry`,
        );
      }

      return {
        code: racedExisting.code,
        discountNodeId:
          racedExisting.id,
        percentage,
        endsAt: racedExisting.endsAt,
        alreadyExisted: true,
      };
    }

    throw new Error(
      `Unable to create review discount ${code}: ${result.userErrors
        .map((error) => {
          const field =
            error.field?.join(".") ||
            null;

          return field
            ? `${field}: ${error.message}`
            : error.message;
        })
        .join("; ")}`,
    );
  }

  const node = result.codeDiscountNode;

  if (!node) {
    throw new Error(
      "Shopify did not return the created discount",
    );
  }

  return {
    code,
    discountNodeId: node.id,
    percentage,
    endsAt,
    alreadyExisted: false,
  };
}
