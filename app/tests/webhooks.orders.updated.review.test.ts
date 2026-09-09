import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  authenticateWebhookMock,
  adminGraphqlMock,

  getReviewOrderMock,
  validateEligibilityMock,

  findReviewFormDefinitionMock,
  getReviewFormSubmissionMock,
  reviewFormFieldValueMock,

  validateSubmissionMock,
  validateContentMock,

  buildReviewRewardKeyMock,
  claimReviewRewardGrantMock,
  claimReviewSignalMock,
  markCompletedMock,
  markRejectedMock,
  markRetryableMock,
  saveDiscountMock,
  saveEmailSentMock,

  createDiscountMock,
  sendReviewEmailMock,

  reviewOrderEmailProductLabelsMock,
  reviewStorefrontUrlMock,

  removeReviewOrderTagsMock,
  transitionReviewOrderTagsMock,
} = vi.hoisted(() => ({
  authenticateWebhookMock: vi.fn(),
  adminGraphqlMock: vi.fn(),

  getReviewOrderMock: vi.fn(),
  validateEligibilityMock: vi.fn(),

  findReviewFormDefinitionMock: vi.fn(),
  getReviewFormSubmissionMock: vi.fn(),
  reviewFormFieldValueMock: vi.fn(),

  validateSubmissionMock: vi.fn(),
  validateContentMock: vi.fn(),

  buildReviewRewardKeyMock: vi.fn(),
  claimReviewRewardGrantMock: vi.fn(),
  claimReviewSignalMock: vi.fn(),
  markCompletedMock: vi.fn(),
  markRejectedMock: vi.fn(),
  markRetryableMock: vi.fn(),
  saveDiscountMock: vi.fn(),
  saveEmailSentMock: vi.fn(),

  createDiscountMock: vi.fn(),
  sendReviewEmailMock: vi.fn(),

  reviewOrderEmailProductLabelsMock:
    vi.fn(),
  reviewStorefrontUrlMock: vi.fn(),

  removeReviewOrderTagsMock: vi.fn(),
  transitionReviewOrderTagsMock: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
}));

vi.mock(
  "../services/review-order.server",
  () => ({
    getReviewOrder:
      getReviewOrderMock,
  }),
);

vi.mock(
  "../services/review-email-eligibility.server",
  () => ({
    validateReviewEmailEligibility:
      validateEligibilityMock,
  }),
);

vi.mock(
  "../services/review-form-submission.server",
  () => ({
    findReviewFormDefinition:
      findReviewFormDefinitionMock,
    getReviewFormSubmission:
      getReviewFormSubmissionMock,
    reviewFormFieldValue:
      reviewFormFieldValueMock,
  }),
);

vi.mock(
  "../services/review-submission-validation.server",
  () => ({
    validateReviewSubmissionAgainstOrder:
      validateSubmissionMock,
  }),
);

vi.mock(
  "../services/review-form-content-validation.server",
  () => ({
    validateReviewFormContent:
      validateContentMock,
  }),
);

vi.mock(
  "../services/review-signal-idempotency.server",
  () => ({
    buildReviewRewardKey:
      buildReviewRewardKeyMock,
    claimReviewRewardGrant:
      claimReviewRewardGrantMock,
    claimReviewSignal:
      claimReviewSignalMock,
    markReviewSignalCompleted:
      markCompletedMock,
    markReviewSignalRejected:
      markRejectedMock,
    markReviewSignalRetryable:
      markRetryableMock,
    saveReviewSignalDiscount:
      saveDiscountMock,
    saveReviewSignalEmailSent:
      saveEmailSentMock,
  }),
);

vi.mock(
  "../services/review-discount.server",
  () => ({
    createOrGetReviewRewardDiscount:
      createDiscountMock,
  }),
);

vi.mock(
  "../services/review-email.server",
  () => ({
    sendReviewEmail:
      sendReviewEmailMock,
  }),
);

vi.mock(
  "../services/review-order-email-context.server",
  () => ({
    reviewOrderEmailProductLabels:
      reviewOrderEmailProductLabelsMock,
    reviewStorefrontUrl:
      reviewStorefrontUrlMock,
  }),
);

vi.mock(
  "../services/review-order-tags.server",
  () => ({
    removeReviewOrderTags:
      removeReviewOrderTagsMock,
    transitionReviewOrderTags:
      transitionReviewOrderTagsMock,
  }),
);

import { action } from "../routes/webhooks.orders.updated";

const shop =
  "b0z0gt-be.myshopify.com";

const orderId =
  "gid://shopify/Order/456";

const customerId =
  "gid://shopify/Customer/99";

const requestReadyTag =
  "lushka-app-14-review-request-ready";

const rewardReadyTag =
  "r14-form-abc";

const day28RewardReadyTag =
  "r28-form-xyz";

const order = {
  id: orderId,
  name: "#1001",
  email: "customer@example.com",

  day14ReviewBridge: {
    handle: "form-abc",
    email: "customer@example.com",
    orderNumber: "1001",
    product:
      "Multi-Peptide Hair Growth Serum",
    review:
      "Really enjoying the product.",
  },

  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "FULFILLED",
  returnStatus: "NO_RETURN",
  tags: [requestReadyTag],
  customer: {
    id: customerId,
    firstName: "Samantha",
    lastName: "Customer",
    defaultEmailAddress: {
      emailAddress:
        "customer@example.com",
      marketingState:
        "SUBSCRIBED",
      marketingUnsubscribeUrl:
        "https://example.com/unsubscribe",
    },
  },
  lineItems: [
    {
      id: "line-1",
      name:
        "Multi-Peptide Hair Growth Serum",
      quantity: 1,
      image: null,
      product: {
        id: "product-1",
        title:
          "Multi-Peptide Hair Growth Serum",
      },
      variant: {
        id: "variant-1",
        title: "Default Title",
      },
      lineItemGroup: null,
    },
  ],
};

function webhookPayload(
  tags: string,
) {
  return {
    admin: {
      graphql: adminGraphqlMock,
    },
    payload: {
      id: 456,
      admin_graphql_api_id:
        orderId,
      name: "#1001",
      tags,
    },
    shop,
    topic: "ORDERS_UPDATED",
    session: {
      id:
        "offline_b0z0gt-be.myshopify.com",
    },
  };
}

function claimedEvent(
  overrides: Record<string, unknown> = {},
) {
  return {
    claimed: true,
    eventId: "event-1",
    signalKey:
      `${shop}|${orderId}|signal`,
    attemptCount: 1,
    reclaimedStaleLease: false,
    discountCode: null,
    providerMessageId: null,
    emailSentAt: null,
    ...overrides,
  };
}

function requestEligibility() {
  return {
    eligible: true,
    recipientEmail:
      "customer@example.com",
    customerName: "Samantha",
  };
}

function mockRequestDefaults() {
  authenticateWebhookMock.mockResolvedValue(
    webhookPayload(requestReadyTag),
  );

  getReviewOrderMock.mockResolvedValue({
    ...order,
    tags: [requestReadyTag],
  });

  claimReviewSignalMock.mockResolvedValue(
    claimedEvent(),
  );

  validateEligibilityMock.mockReturnValue(
    requestEligibility(),
  );

  reviewOrderEmailProductLabelsMock.mockReturnValue([
    "Multi-Peptide Hair Growth Serum",
  ]);

  reviewStorefrontUrlMock.mockReturnValue(
    `https://${shop}`,
  );

  sendReviewEmailMock.mockResolvedValue({
    providerMessageId: "resend-1",
  });

  saveEmailSentMock.mockResolvedValue(
    undefined,
  );

  markCompletedMock.mockResolvedValue(
    undefined,
  );

  transitionReviewOrderTagsMock.mockResolvedValue(
    undefined,
  );

  removeReviewOrderTagsMock.mockResolvedValue(
    undefined,
  );

  markRejectedMock.mockResolvedValue(
    undefined,
  );

  markRetryableMock.mockResolvedValue(
    undefined,
  );
}

function mockRewardDefaults({
  readyTag = rewardReadyTag,
}: {
  readyTag?: string;
} = {}) {
  authenticateWebhookMock.mockResolvedValue(
    webhookPayload(readyTag),
  );

  getReviewOrderMock.mockResolvedValue({
    ...order,
    tags: [readyTag],
  });

  claimReviewSignalMock.mockResolvedValue(
    claimedEvent({
      signalKey:
        `${shop}|${orderId}|reward`,
    }),
  );

  buildReviewRewardKeyMock.mockReturnValue(
    `${shop}|${orderId}|REWARD|DAY_14`,
  );

  claimReviewRewardGrantMock.mockResolvedValue({
    claimed: true,
    rewardKey:
      `${shop}|${orderId}|REWARD|DAY_14`,
  });

  validateEligibilityMock.mockReturnValue(
    requestEligibility(),
  );

  findReviewFormDefinitionMock.mockResolvedValue({
    id: "definition-1",
    name:
      "Lushka – 14 D Review",
    type: "$app:review",
    fieldDefinitions: [],
  });

  getReviewFormSubmissionMock.mockResolvedValue({
    id: "metaobject-1",
    handle: "form-abc",
    type: "$app:review",
    fields: [],
  });

  reviewFormFieldValueMock
    .mockReturnValueOnce(
      "customer@example.com",
    )
    .mockReturnValueOnce("#1001")
    .mockReturnValueOnce(
      "Multi-Peptide Hair Growth Serum",
    );

  validateSubmissionMock.mockReturnValue({
    valid: true,
    matchedProductLabel:
      "Multi-Peptide Hair Growth Serum",
  });

  validateContentMock.mockReturnValue({
    valid: true,
  });

  createDiscountMock.mockResolvedValue({
    code: "LUSHKA10-ABC123",
    discountNodeId:
      "gid://shopify/DiscountCodeNode/1",
    percentage: 10,
    endsAt: null,
    alreadyExisted: false,
  });

  saveDiscountMock.mockResolvedValue(
    undefined,
  );

  reviewOrderEmailProductLabelsMock.mockReturnValue([
    "Multi-Peptide Hair Growth Serum",
  ]);

  reviewStorefrontUrlMock.mockReturnValue(
    `https://${shop}`,
  );

  sendReviewEmailMock.mockResolvedValue({
    providerMessageId: "resend-1",
  });

  saveEmailSentMock.mockResolvedValue(
    undefined,
  );

  markCompletedMock.mockResolvedValue(
    undefined,
  );

  transitionReviewOrderTagsMock.mockResolvedValue(
    undefined,
  );

  removeReviewOrderTagsMock.mockResolvedValue(
    undefined,
  );

  markRejectedMock.mockResolvedValue(
    undefined,
  );

  markRetryableMock.mockResolvedValue(
    undefined,
  );
}

function executeWebhook() {
  return action({
    request: new Request(
      "https://example.com/webhooks/orders/updated",
      {
        method: "POST",
      },
    ),
  } as unknown as Parameters<typeof action>[0]);
}

describe(
  "orders updated review webhook safety",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "ignores order updates without a Lushka READY tag",
      async () => {
        authenticateWebhookMock.mockResolvedValue(
          webhookPayload(
            "ordinary-shopify-tag",
          ),
        );

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          getReviewOrderMock,
        ).not.toHaveBeenCalled();

        expect(
          claimReviewSignalMock,
        ).not.toHaveBeenCalled();

        expect(
          sendReviewEmailMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "sends the day-14 request once without creating a discount",
      async () => {
        mockRequestDefaults();

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          createDiscountMock,
        ).not.toHaveBeenCalled();

        expect(
          sendReviewEmailMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          sendReviewEmailMock,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            to:
              "customer@example.com",
            emailType:
              "DAY_14_REVIEW_REQUEST",
            orderName: "#1001",
            unsubscribeUrl:
              "https://example.com/unsubscribe",
          }),
        );

        expect(
          saveEmailSentMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
          providerMessageId:
            "resend-1",
        });

        expect(
          markCompletedMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
        });

        expect(
          transitionReviewOrderTagsMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          orderId,
          readyTag:
            requestReadyTag,
          finalTags: [
            "lushka-14-review-request-sent",
          ],
        });
      },
    );

    it(
      "creates 10% reward and sends day-14 reward email",
      async () => {
        mockRewardDefaults();

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          createDiscountMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          signalKey:
            `${shop}|${orderId}|reward`,
          customerId,
          percentage: 10,
          expiresInDays: null,
        });

        expect(
          saveDiscountMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
          discountCode:
            "LUSHKA10-ABC123",
        });

        expect(
          sendReviewEmailMock,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            emailType:
              "DAY_14_REVIEW_REWARD",
            discountCode:
              "LUSHKA10-ABC123",
          }),
        );

        expect(
          transitionReviewOrderTagsMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          orderId,
          readyTag:
            rewardReadyTag,
          finalTags: [
            "lushka-14-review-completed",
          ],
        });
      },
    );

    it(
      "creates 20% day-28 reward with 30-day expiry configuration",
      async () => {
        mockRewardDefaults({
          readyTag:
            day28RewardReadyTag,
        });

        findReviewFormDefinitionMock.mockResolvedValue({
          id: "definition-28",
          name:
            "Lushka – 28 Day Review + Photos",
          type:
            "$app:review-photo",
          fieldDefinitions: [],
        });

        createDiscountMock.mockResolvedValue({
          code: "LUSHKA20-XYZ789",
          discountNodeId:
            "gid://shopify/DiscountCodeNode/2",
          percentage: 20,
          endsAt:
            new Date(
              "2026-10-09T00:00:00.000Z",
            ),
          alreadyExisted: false,
        });

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          createDiscountMock,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            percentage: 20,
            expiresInDays: 30,
          }),
        );

        expect(
          sendReviewEmailMock,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            emailType:
              "DAY_28_REVIEW_REWARD",
            discountCode:
              "LUSHKA20-XYZ789",
            discountEndsAt:
              new Date(
                "2026-10-09T00:00:00.000Z",
              ),
          }),
        );

        expect(
          transitionReviewOrderTagsMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          orderId,
          readyTag:
            day28RewardReadyTag,
          finalTags: [
            "lushka-28-review-completed",
          ],
        });
      },
    );

    it(
      "does not repeat email for an already completed duplicate signal",
      async () => {
        mockRequestDefaults();

        claimReviewSignalMock.mockResolvedValue({
          claimed: false,
          eventId: "event-1",
          signalKey:
            `${shop}|${orderId}|signal`,
          reason:
            "ALREADY_COMPLETED",
        });

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          sendReviewEmailMock,
        ).not.toHaveBeenCalled();

        expect(
          createDiscountMock,
        ).not.toHaveBeenCalled();

        expect(
          transitionReviewOrderTagsMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          orderId,
          readyTag:
            requestReadyTag,
          finalTags: [
            "lushka-14-review-request-sent",
          ],
        });
      },
    );

    it(
      "rejects invalid reward submission and removes READY without emailing",
      async () => {
        mockRewardDefaults();

        validateSubmissionMock.mockReturnValue({
          valid: false,
          reason:
            "Submitted email does not belong to the exact Shopify order/customer",
        });

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          markRejectedMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
          reason:
            "Submitted email does not belong to the exact Shopify order/customer",
        });

        expect(
          removeReviewOrderTagsMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          orderId,
          tags: [
            rewardReadyTag,
          ],
        });

        expect(
          claimReviewRewardGrantMock,
        ).not.toHaveBeenCalled();

        expect(
          createDiscountMock,
        ).not.toHaveBeenCalled();

        expect(
          sendReviewEmailMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a second valid reward for the same order and review stage",
      async () => {
        mockRewardDefaults();

        const rewardKey =
          `${shop}|${orderId}|REWARD|DAY_14`;

        buildReviewRewardKeyMock.mockReturnValue(
          rewardKey,
        );

        claimReviewRewardGrantMock.mockResolvedValue({
          claimed: false,
          rewardKey,
          reason: "ALREADY_GRANTED",
        });

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          claimReviewRewardGrantMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
          rewardKey,
        });

        expect(
          markRejectedMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
          reason:
            "Reward already granted for this order and review stage",
        });

        expect(
          removeReviewOrderTagsMock,
        ).toHaveBeenCalledWith({
          graphql: adminGraphqlMock,
          orderId,
          tags: [
            rewardReadyTag,
          ],
        });

        expect(
          createDiscountMock,
        ).not.toHaveBeenCalled();

        expect(
          saveDiscountMock,
        ).not.toHaveBeenCalled();

        expect(
          sendReviewEmailMock,
        ).not.toHaveBeenCalled();

        expect(
          markCompletedMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "skips Resend when delivery was already persisted and only completes final state",
      async () => {
        mockRequestDefaults();

        claimReviewSignalMock.mockResolvedValue(
          claimedEvent({
            emailSentAt:
              new Date(
                "2026-09-09T00:00:00.000Z",
              ),
            providerMessageId:
              "resend-existing",
          }),
        );

        const response =
          await executeWebhook();

        expect(response.status).toBe(200);

        expect(
          sendReviewEmailMock,
        ).not.toHaveBeenCalled();

        expect(
          saveEmailSentMock,
        ).not.toHaveBeenCalled();

        expect(
          markCompletedMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
        });

        expect(
          transitionReviewOrderTagsMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "keeps durable completion when Shopify tag transition fails",
      async () => {
        mockRequestDefaults();

        transitionReviewOrderTagsMock.mockRejectedValue(
          new Error(
            "Shopify tag update failed",
          ),
        );

        const response =
          await executeWebhook();

        expect(response.status).toBe(500);

        expect(
          sendReviewEmailMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          markCompletedMock,
        ).toHaveBeenCalledWith({
          eventId: "event-1",
          attemptCount: 1,
        });

        /*
         * After durable COMPLETED, the route must not downgrade the
         * event back to RETRYABLE just because Shopify tag cleanup
         * failed.
         */
        expect(
          markRetryableMock,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
