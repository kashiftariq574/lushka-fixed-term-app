import { describe, expect, it, vi } from "vitest";

import {
  BillingAttemptDefinitiveError,
  BillingAttemptUncertainError,
  createBillingAttempt,
} from "./billing.server";

describe("createBillingAttempt", () => {
  it("uses the selected billing cycle expected date as originTime", async () => {
    const expectedDate = "2026-11-11T07:00:00.000Z";

    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingCycle: {
                billingAttemptExpectedDate: expectedDate,
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingAttemptCreate: {
                subscriptionBillingAttempt: {
                  id: "gid://shopify/SubscriptionBillingAttempt/123",
                  ready: true,
                  errorMessage: null,
                  nextActionUrl: null,
                  order: {
                    id: "gid://shopify/Order/456",
                  },
                },
                userErrors: [],
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    const result = await createBillingAttempt(
      graphql,
      "gid://shopify/SubscriptionContract/123",
      2,
      "test-idempotency-key",
    );

    expect(graphql).toHaveBeenCalledTimes(2);

    expect(graphql.mock.calls[1][1]).toEqual({
      variables: {
        contractId: "gid://shopify/SubscriptionContract/123",
        input: {
          billingCycleSelector: {
            index: 2,
          },
          idempotencyKey: "test-idempotency-key",
          originTime: expectedDate,
        },
      },
    });

    expect(result).toEqual({
      idempotencyKey: "test-idempotency-key",
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/123",
        ready: true,
        errorMessage: null,
        nextActionUrl: null,
        order: {
          id: "gid://shopify/Order/456",
        },
      },
    });
  });

  it("throws BillingAttemptDefinitiveError when billing-cycle lookup fails before submit", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "cycle missing" }],
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(
      createBillingAttempt(
        graphql,
        "gid://shopify/SubscriptionContract/123",
        1,
        "test-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BillingAttemptDefinitiveError);

    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("throws BillingAttemptDefinitiveError when mutation returns userErrors", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingCycle: {
                billingAttemptExpectedDate:
                  "2026-11-11T07:00:00.000Z",
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingAttemptCreate: {
                subscriptionBillingAttempt: null,
                userErrors: [
                  {
                    field: ["idempotencyKey"],
                    message: "Already used",
                  },
                ],
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    await expect(
      createBillingAttempt(
        graphql,
        "gid://shopify/SubscriptionContract/123",
        1,
        "test-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BillingAttemptDefinitiveError);
  });

  it("throws BillingAttemptUncertainError when mutation transport fails", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingCycle: {
                billingAttemptExpectedDate:
                  "2026-11-11T07:00:00.000Z",
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockRejectedValueOnce(new Error("network timeout"));

    await expect(
      createBillingAttempt(
        graphql,
        "gid://shopify/SubscriptionContract/123",
        1,
        "test-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BillingAttemptUncertainError);
  });

  it("throws BillingAttemptUncertainError when mutation response parsing fails", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingCycle: {
                billingAttemptExpectedDate:
                  "2026-11-11T07:00:00.000Z",
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce({
        json: async () => {
          throw new Error("invalid json");
        },
      } as unknown as Response);

    await expect(
      createBillingAttempt(
        graphql,
        "gid://shopify/SubscriptionContract/123",
        1,
        "test-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BillingAttemptUncertainError);
  });

  it("throws BillingAttemptUncertainError for partial payload with top-level GraphQL errors", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingCycle: {
                billingAttemptExpectedDate:
                  "2026-11-11T07:00:00.000Z",
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingAttemptCreate: {
                subscriptionBillingAttempt: {
                  id: "gid://shopify/SubscriptionBillingAttempt/partial",
                  ready: false,
                },
                userErrors: [],
              },
            },
            errors: [
              {
                message: "Internal error",
              },
            ],
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    await expect(
      createBillingAttempt(
        graphql,
        "gid://shopify/SubscriptionContract/123",
        1,
        "test-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BillingAttemptUncertainError);
  });

  it("throws BillingAttemptUncertainError when payload exists but subscriptionBillingAttempt is null", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingCycle: {
                billingAttemptExpectedDate:
                  "2026-11-11T07:00:00.000Z",
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              subscriptionBillingAttemptCreate: {
                subscriptionBillingAttempt: null,
                userErrors: [],
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    await expect(
      createBillingAttempt(
        graphql,
        "gid://shopify/SubscriptionContract/123",
        1,
        "test-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BillingAttemptUncertainError);
  });
});
