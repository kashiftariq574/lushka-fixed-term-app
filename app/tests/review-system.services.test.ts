import { describe, expect, it } from "vitest";

import type { ReviewOrder } from "../services/review-order.server";
import { validateReviewEmailEligibility } from "../services/review-email-eligibility.server";
import { validateReviewSubmissionAgainstOrder } from "../services/review-submission-validation.server";
import { validateReviewFormContent } from "../services/review-form-content-validation.server";
import {
  reviewOrderEmailProductLabels,
  reviewStorefrontUrl,
} from "../services/review-order-email-context.server";
import {
  buildReviewDiscountCode,
  createOrGetReviewRewardDiscount,
} from "../services/review-discount.server";
import { reviewSignalFinalState } from "../services/review-signal-state.server";
import { findReviewFormDefinition } from "../services/review-form-submission.server";

function makeOrder(
  overrides: Partial<ReviewOrder> = {},
): ReviewOrder {
  return {
    id: "gid://shopify/Order/123",
    name: "#1001",
    email: "customer@example.com",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    returnStatus: "NO_RETURN",
    tags: [
      "lushka-app-14-review-request-ready",
    ],
    customer: {
      id: "gid://shopify/Customer/99",
      firstName: "Samantha",
      lastName: "Customer",
      defaultEmailAddress: {
        emailAddress:
          "customer@example.com",
        marketingState: "SUBSCRIBED",
        marketingUnsubscribeUrl:
          "https://example.com/unsubscribe",
      },
    },
    lineItems: [
      {
        id: "gid://shopify/LineItem/1",
        name:
          "Multi-Peptide Hair Growth Serum",
        quantity: 1,
        image: null,
        product: {
          id: "gid://shopify/Product/1",
          title:
            "Multi-Peptide Hair Growth Serum",
        },
        variant: {
          id: "gid://shopify/ProductVariant/1",
          title: "Default Title",
        },
        lineItemGroup: null,
      },
    ],
    ...overrides,
  };
}

type ReviewDiscountMutationInput = {
  code: string;
  customerGets: {
    value: {
      percentage: number;
    };
  };
  context: {
    customers?: {
      add: string[];
    };
    all?: string;
  };
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
  startsAt: string;
  endsAt: string;
};

describe("review email eligibility", () => {
  it("allows a subscribed fulfilled request with unsubscribe URL", () => {
    const result =
      validateReviewEmailEligibility({
        order: makeOrder(),
        readyTag:
          "lushka-app-14-review-request-ready",
        requireMarketingSubscription: true,
      });

    expect(result.eligible).toBe(true);
  });

  it("rejects request email when customer is unsubscribed", () => {
    const order = makeOrder({
      customer: {
        ...makeOrder().customer!,
        defaultEmailAddress: {
          ...makeOrder().customer!
            .defaultEmailAddress!,
          marketingState: "UNSUBSCRIBED",
        },
      },
    });

    const result =
      validateReviewEmailEligibility({
        order,
        readyTag:
          "lushka-app-14-review-request-ready",
        requireMarketingSubscription: true,
      });

    expect(result.eligible).toBe(false);
  });

  it("does not require marketing subscription for reward delivery", () => {
    const order = makeOrder({
      tags: [
        "r14-form-abc",
      ],
      customer: {
        ...makeOrder().customer!,
        defaultEmailAddress: {
          ...makeOrder().customer!
            .defaultEmailAddress!,
          marketingState: "UNSUBSCRIBED",
          marketingUnsubscribeUrl: "",
        },
      },
    });

    const result =
      validateReviewEmailEligibility({
        order,
        readyTag:
          "r14-form-abc",
        requireMarketingSubscription: false,
      });

    expect(result.eligible).toBe(true);
  });
});

describe("review submission order validation", () => {
  it("accepts matching order, email and product", () => {
    const result =
      validateReviewSubmissionAgainstOrder({
        order: makeOrder(),
        submittedOrderNumber: "#1001",
        submittedEmail:
          "CUSTOMER@example.com",
        submittedProduct:
          "Multi Peptide Hair Growth Serum",
      });

    expect(result.valid).toBe(true);
  });

  it("rejects a submission with another email", () => {
    const result =
      validateReviewSubmissionAgainstOrder({
        order: makeOrder(),
        submittedOrderNumber: "#1001",
        submittedEmail:
          "attacker@example.com",
        submittedProduct:
          "Multi Peptide Hair Growth Serum",
      });

    expect(result.valid).toBe(false);
  });

  it("recognises a bundle parent title", () => {
    const order = makeOrder({
      lineItems: [
        {
          id: "gid://shopify/LineItem/1",
          name: "Hair Growth Serum",
          quantity: 1,
          image: null,
          product: {
            id: "gid://shopify/Product/1",
            title: "Hair Growth Serum",
          },
          variant: {
            id: "gid://shopify/ProductVariant/1",
            title: "Default Title",
          },
          lineItemGroup: {
            id: "gid://shopify/LineItemGroup/1",
            title:
              "Complete Haircare Recovery 90",
            quantity: 1,
            productId:
              "gid://shopify/Product/90",
            variantId:
              "gid://shopify/ProductVariant/90",
          },
        },
      ],
    });

    const result =
      validateReviewSubmissionAgainstOrder({
        order,
        submittedOrderNumber: "1001",
        submittedEmail:
          "customer@example.com",
        submittedProduct:
          "Complete Haircare Recovery 90",
      });

    expect(result.valid).toBe(true);
  });
});

describe("review form required content", () => {
  it("requires review text for day-14 reward", () => {
    const result =
      validateReviewFormContent({
        signalType:
          "DAY_14_REVIEW_REWARD",
        submission: {
          id: "meta-1",
          handle: "form-1",
          type: "review",
          fields: [],
        },
      });

    expect(result.valid).toBe(false);
  });

  it("accepts review + photo + ownership consent for day-28", () => {
    const result =
      validateReviewFormContent({
        signalType:
          "DAY_28_REVIEW_PHOTOS_REWARD",
        submission: {
          id: "meta-2",
          handle: "form-2",
          type: "review-photo",
          fields: [
            {
              key: "review",
              value: "Great progress",
              jsonValue: null,
              definition: {
                key: "review",
                name: "Review",
                type: "single_line_text_field",
              },
            },
            {
              key: "photo_1",
              value:
                "gid://shopify/GenericFile/1",
              jsonValue: {
                id:
                  "gid://shopify/GenericFile/1",
              },
              definition: {
                key: "photo_1",
                name: "Photo 1",
                type: "file_reference",
              },
            },
            {
              key: "ownership",
              value: "true",
              jsonValue: true,
              definition: {
                key: "ownership",
                name:
                  "Image ownership consent",
                type: "boolean",
              },
            },
          ],
        },
      });

    expect(result.valid).toBe(true);
  });

  it("rejects photos-only submission without ownership consent", () => {
    const result =
      validateReviewFormContent({
        signalType:
          "DAY_28_PHOTOS_ONLY_REWARD",
        submission: {
          id: "meta-3",
          handle: "form-3",
          type: "photo-only",
          fields: [
            {
              key: "photo_1",
              value:
                "gid://shopify/GenericFile/1",
              jsonValue: {
                id:
                  "gid://shopify/GenericFile/1",
              },
              definition: {
                key: "photo_1",
                name: "Photo 1",
                type: "file_reference",
              },
            },
          ],
        },
      });

    expect(result.valid).toBe(false);
  });
});

describe("review order email context", () => {
  it("shows bundle parent once and its components", () => {
    const group = {
      id: "gid://shopify/LineItemGroup/1",
      title:
        "Complete Haircare Recovery 90",
      quantity: 1,
      productId:
        "gid://shopify/Product/90",
      variantId:
        "gid://shopify/ProductVariant/90",
    };

    const order = makeOrder({
      lineItems: [
        {
          id: "line-1",
          name: "Hair Serum",
          quantity: 1,
          image: null,
          product: {
            id: "product-1",
            title: "Hair Serum",
          },
          variant: null,
          lineItemGroup: group,
        },
        {
          id: "line-2",
          name: "Hair Shampoo",
          quantity: 1,
          image: null,
          product: {
            id: "product-2",
            title: "Hair Shampoo",
          },
          variant: null,
          lineItemGroup: group,
        },
      ],
    });

    expect(
      reviewOrderEmailProductLabels(order),
    ).toEqual([
      "Complete Haircare Recovery 90",
      "↳ Hair Serum",
      "↳ Hair Shampoo",
    ]);
  });
});

describe("review storefront URL", () => {
  it("uses the configured branded storefront origin", () => {
    const previous =
      process.env.SHOP_STOREFRONT_URL;

    try {
      process.env.SHOP_STOREFRONT_URL =
        "https://www.lushka.example/";

      expect(
        reviewStorefrontUrl(
          "b0z0gt-be.myshopify.com",
        ),
      ).toBe(
        "https://www.lushka.example",
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .SHOP_STOREFRONT_URL;
      } else {
        process.env.SHOP_STOREFRONT_URL =
          previous;
      }
    }
  });

  it("falls back to the permanent Shopify domain", () => {
    const previous =
      process.env.SHOP_STOREFRONT_URL;

    try {
      delete process.env
        .SHOP_STOREFRONT_URL;

      expect(
        reviewStorefrontUrl(
          "B0Z0GT-BE.MYSHOPIFY.COM",
        ),
      ).toBe(
        "https://b0z0gt-be.myshopify.com",
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .SHOP_STOREFRONT_URL;
      } else {
        process.env.SHOP_STOREFRONT_URL =
          previous;
      }
    }
  });

  it("rejects a non-http storefront URL", () => {
    const previous =
      process.env.SHOP_STOREFRONT_URL;

    try {
      process.env.SHOP_STOREFRONT_URL =
        "javascript:alert(1)";

      expect(() =>
        reviewStorefrontUrl(
          "b0z0gt-be.myshopify.com",
        ),
      ).toThrow(
        "SHOP_STOREFRONT_URL must use http or https",
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .SHOP_STOREFRONT_URL;
      } else {
        process.env.SHOP_STOREFRONT_URL =
          previous;
      }
    }
  });
});

describe("review discount safety", () => {
  it("builds deterministic unique-looking codes", () => {
    const first =
      buildReviewDiscountCode({
        signalKey:
          "shop|order|DAY_14_REVIEW_REWARD|abc",
        percentage: 10,
      });

    const second =
      buildReviewDiscountCode({
        signalKey:
          "shop|order|DAY_14_REVIEW_REWARD|abc",
        percentage: 10,
      });

    expect(first).toBe(second);
    expect(first).toMatch(
      /^LUSHKA10-[A-F0-9]{12}$/,
    );
  });

  it("creates 20% reward with exactl-day expiry", async () => {
    let mutationInput:
      | ReviewDiscountMutationInput
      | undefined;

    const graphql = async (
      query: string,
      options?: {
        variables?: Record<string, unknown>;
      },
    ) => {
      if (
        query.includes(
          "ReviewRewardDiscountByCode",
        )
      ) {
        return new Response(
          JSON.stringify({
            data: {
              codeDiscountNodeByCode: null,
            },
          }),
        );
      }

      mutationInput =
        options?.variables?.input as ReviewDiscountMutationInput;

      return new Response(
        JSON.stringify({
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: {
                id:
                  "gid://shopify/DiscountCodeNode/1",
                codeDiscount: {
                  __typename:
                    "DiscountCodeBasic",
                  title:
                    "Lushka 20% review reward",
                  codes: {
                    nodes: [
                      {
                        code:
                          mutationInput?.code,
                      },
                    ],
                  },
                },
              },
              userErrors: [],
            },
          },
        }),
      );
    };

    const result =
      await createOrGetReviewRewardDiscount({
        graphql,
        signalKey:
          "shop|order|DAY_28_REVIEW_PHOTOS_REWARD|abc",
        customerId:
          "gid://shopify/Customer/99",
        percentage: 20,
        expiresInDays: 30,
      });

    const startsAt = new Date(
      mutationInput!.startsAt,
    );

    const endsAt = new Date(
      mutationInput!.endsAt,
    );

    expect(
      endsAt.getTime() -
        startsAt.getTime(),
    ).toBe(
      30 * 24 * 60 * 60 * 1000,
    );

    expect(
      mutationInput!.customerGets.value
        .percentage,
    ).toBe(0.2);

    expect(
      mutationInput!.context.customers!.add,
    ).toEqual([
      "gid://shopify/Customer/99",
    ]);

    expect(result.percentage).toBe(20);
  });

  it("uses ALL buyer context for guest reward", async () => {
    let mutationInput:
      | ReviewDiscountMutationInput
      | undefined;

    const graphql = async (
      query: string,
      options?: {
        variables?: Record<string, unknown>;
      },
    ) => {
      if (
        query.includes(
          "ReviewRewardDiscountByCode",
        )
      ) {
        return new Response(
          JSON.stringify({
            data: {
              codeDiscountNodeByCode: null,
            },
          }),
        );
      }

      mutationInput =
        options?.variables?.input as ReviewDiscountMutationInput;

      return new Response(
        JSON.stringify({
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: {
                id:
                  "gid://shopify/DiscountCodeNode/2",
              },
              userErrors: [],
            },
          },
        }),
      );
    };

    await createOrGetReviewRewardDiscount({
      graphql,
      signalKey:
        "shop|order|DAY_14_REVIEW_REWARD|guest",
      customerId: null,
      percentage: 10,
      expiresInDays: null,
    });

    expect(
      mutationInput!.context,
    ).toEqual({
      all: "ALL",
    });

    expect(mutationInput!.usageLimit).toBe(1);
  });
});

describe("review final-state tags", () => {
  it("maps each workflow to its durable final tag", () => {
    expect(
      reviewSignalFinalState(
        "DAY_14_REVIEW_REQUEST",
      ).successTags,
    ).toEqual([
      "lushka-14-review-request-sent",
    ]);

    expect(
      reviewSignalFinalState(
        "DAY_14_REVIEW_REWARD",
      ).successTags,
    ).toEqual([
      "lushka-14-review-completed",
    ]);

    expect(
      reviewSignalFinalState(
        "DAY_28_PHOTOS_ONLY_REWARD",
      ).successTags,
    ).toEqual([
      "lushka-28-review-completed",
    ]);
  });
});

describe("Shopify Forms definition lookup", () => {
  it(
    "finds generated Shopify Forms definition from exact submission handle",
    async () => {
      const generatedType =
        "app--6171699--shopify-forms1143887";

      const graphql = async (
        query: string,
      ): Promise<Response> => {
        if (
          query.includes(
            "ReviewFormDefinitions",
          )
        ) {
          return new Response(
            JSON.stringify({
              data: {
                metaobjectDefinitions: {
                  nodes: [
                    {
                      id:
                        "gid://shopify/MetaobjectDefinition/1",
                      name:
                        "Shopify Forms submission",
                      type: generatedType,
                      fieldDefinitions: [
                        {
                          key:
                            "form_display_name",
                          name:
                            "Form display name",
                          type: {
                            name:
                              "single_line_text_field",
                          },
                        },
                        {
                          key: "email",
                          name: "Email",
                          type: {
                            name:
                              "single_line_text_field",
                          },
                        },
                      ],
                    },
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null,
                  },
                },
              },
            }),
          );
        }

        if (
          query.includes(
            "ReviewFormSubmission",
          )
        ) {
          return new Response(
            JSON.stringify({
              data: {
                metaobjectByHandle: {
                  id:
                    "gid://shopify/Metaobject/1",
                  handle:
                    "september-09-2026-at-12-48-20-543-pm",
                  type: generatedType,
                  fields: [
                    {
                      key:
                        "form_display_name",
                      value:
                        "Lushka – 14 Day Review",
                      jsonValue:
                        "shka – 14 Day Review",
                      definition: {
                        key:
                          "form_display_name",
                        name:
                          "Form display name",
                        type: {
                          name:
                            "single_line_text_field",
                        },
                      },
                    },
                  ],
                },
              },
            }),
          );
        }

        throw new Error(
          "Unexpected GraphQL query",
        );
      };

      const definition =
        await findReviewFormDefinition({
          graphql,
          name:
            "Lushka – 14 Day Review",
          handle:
            "september-09-2026-at-12-48-20-543-pm",
        });

      expect(definition.type).toBe(
        generatedType,
      );

      expect(definition.name).toBe(
        "Shopify Forms submission",
      );
    },
  );
});

