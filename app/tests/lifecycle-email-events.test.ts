import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  emailEventUpsertMock,
  emailEventFindManyMock,
  emailEventUpdateManyMock,
  emailEventUpdateMock,
  contractStateFindUniqueMock,
  sendLushkaEmailMock,
  adminGraphqlMock,
} = vi.hoisted(() => ({
  emailEventUpsertMock: vi.fn(),
  emailEventFindManyMock: vi.fn(),
  emailEventUpdateManyMock: vi.fn(),
  emailEventUpdateMock: vi.fn(),
  contractStateFindUniqueMock: vi.fn(),
  sendLushkaEmailMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    emailEvent: {
      upsert: emailEventUpsertMock,
      findMany: emailEventFindManyMock,
      updateMany: emailEventUpdateManyMock,
      update: emailEventUpdateMock,
    },
    contractState: {
      findUnique:
        contractStateFindUniqueMock,
    },
  },
}));

vi.mock("../services/email.server", () => ({
  sendLushkaEmail:
    sendLushkaEmailMock,
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: vi.fn().mockResolvedValue({
      admin: {
        graphql: adminGraphqlMock,
      },
    }),
  },
}));

import {
  processDueLifecycleEmails,
  scheduleLifecycleEmails,
  scheduleRootRevivalLifecycleEmails,
} from "../services/lifecycle-email-events.server";

describe("lifecycle email events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    emailEventUpsertMock.mockResolvedValue(
      {},
    );

    emailEventUpdateManyMock.mockResolvedValue(
      {
        count: 1,
      },
    );

    emailEventUpdateMock.mockResolvedValue(
      {},
    );

    contractStateFindUniqueMock.mockResolvedValue(
      {
        planType:
          "COMPLETE_RECOVERY_90",
      },
    );

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            customer: {
              firstName: "Samantha",
            },
          },
        },
      }),
    });

    sendLushkaEmailMock.mockResolvedValue({
      providerMessageId:
        "brevo-message-1",
    });
  });

  it(
    "schedules Day 0, 30, 60 and 75 exactly once per contract/email type",
    async () => {
      const startedAt = new Date(
        "2026-09-10T00:00:00.000Z",
      );

      const result =
        await scheduleLifecycleEmails({
          shop:
            "b0z0gt-be.myshopify.com",
          contractId:
            "gid://shopify/SubscriptionContract/123",
          recipientEmail:
            "customer@example.com",
          startedAt,
        });

      expect(result).toEqual({
        scheduled: 4,
      });

      expect(
        emailEventUpsertMock,
      ).toHaveBeenCalledTimes(4);

      const calls =
        emailEventUpsertMock.mock.calls.map(
          ([input]) => input,
        );

      expect(
        calls.map(
          (input) =>
            input.create.emailType,
        ),
      ).toEqual([
        "DAY_0_WELCOME",
        "DAY_30_CHECKIN",
        "DAY_60_FINAL_RITUAL",
        "DAY_75_CONTINUATION",
      ]);

      expect(
        calls.map((input) =>
          input.create.dueAt.toISOString(),
        ),
      ).toEqual([
        "2026-09-10T00:00:00.000Z",
        "2026-10-10T00:00:00.000Z",
        "2026-11-09T00:00:00.000Z",
        "2026-11-24T00:00:00.000Z",
      ]);

      expect(
        calls[3].where,
      ).toEqual({
        contractId_emailType: {
          contractId:
            "gid://shopify/SubscriptionContract/123",
          emailType:
            "DAY_75_CONTINUATION",
        },
      });

      expect(
        calls[3].create.idempotencyKey,
      ).toBe(
        "lushka:gid://shopify/SubscriptionContract/123:DAY_75_CONTINUATION",
      );
    },
  );

  it.each([
    {
      intervalWeeks: 4 as const,
      expectedDueDates: [
        "2026-09-10T00:00:00.000Z",
        "2026-10-08T00:00:00.000Z",
        "2026-11-05T00:00:00.000Z",
        "2026-11-20T00:00:00.000Z",
      ],
    },
    {
      intervalWeeks: 6 as const,
      expectedDueDates: [
        "2026-09-10T00:00:00.000Z",
        "2026-10-22T00:00:00.000Z",
        "2026-12-03T00:00:00.000Z",
        "2026-12-18T00:00:00.000Z",
      ],
    },
    {
      intervalWeeks: 8 as const,
      expectedDueDates: [
        "2026-09-10T00:00:00.000Z",
        "2026-11-05T00:00:00.000Z",
        "2026-12-31T00:00:00.000Z",
        "2027-01-15T00:00:00.000Z",
      ],
    },
  ])(
    "schedules Root Revival lifecycle for $intervalWeeks-week interval",
    async ({
      intervalWeeks,
      expectedDueDates,
    }) => {
      const startedAt = new Date(
        "2026-09-10T00:00:00.000Z",
      );

      const result =
        await scheduleRootRevivalLifecycleEmails({
          shop:
            "b0z0gt-be.myshopify.com",
          contractId:
            "gid://shopify/SubscriptionContract/root-123",
          recipientEmail:
            "customer@example.com",
          startedAt,
          intervalWeeks,
        });

      expect(result).toEqual({
        scheduled: 4,
        intervalWeeks,
      });

      expect(
        emailEventUpsertMock,
      ).toHaveBeenCalledTimes(4);

      const calls =
        emailEventUpsertMock.mock.calls.map(
          ([input]) => input,
        );

      expect(
        calls.map(
          (input) =>
            input.create.emailType,
        ),
      ).toEqual([
        "ROOT_WELCOME",
        "ROOT_SECOND_DELIVERY",
        "ROOT_FINAL_DELIVERY",
        "ROOT_CONTINUATION",
      ]);

      expect(
        calls.map((input) =>
          input.create.dueAt.toISOString(),
        ),
      ).toEqual(expectedDueDates);
    },
  );

  it(
    "sends a due Day-75 email and marks the event sent",
    async () => {
      const event = {
        id: "event-75",
        shop:
          "b0z0gt-be.myshopify.com",
        contractId:
          "gid://shopify/SubscriptionContract/123",
        orderId: null,
        emailType:
          "DAY_75_CONTINUATION",
        recipientEmail:
          "customer@example.com",
        idempotencyKey:
          "lushka:contract-123:DAY_75_CONTINUATION",
        status: "PENDING",
        attemptCount: 0,
        providerMessageId: null,
        error: null,
        dueAt: new Date(
          "2026-11-24T00:00:00.000Z",
        ),
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      emailEventFindManyMock.mockResolvedValue([
        event,
      ]);

      const result =
        await processDueLifecycleEmails(
          new Date(
            "2026-11-24T01:00:00.000Z",
          ),
        );

      expect(
        sendLushkaEmailMock,
      ).toHaveBeenCalledWith({
        to: "customer@example.com",
        emailType:
          "DAY_75_CONTINUATION",
        customerName: "Samantha",
        productImage: null,
        planType:
          "COMPLETE_RECOVERY_90",
        idempotencyKey:
          "lushka:contract-123:DAY_75_CONTINUATION",
      });

      expect(
        emailEventUpdateMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "event-75",
          },
          data:
            expect.objectContaining({
              status: "SENT",
              providerMessageId:
                "brevo-message-1",
              error: null,
            }),
        }),
      );

      expect(result.dueCount).toBe(1);

      expect(result.results).toEqual([
        expect.objectContaining({
          eventId: "event-75",
          emailType:
            "DAY_75_CONTINUATION",
          sent: true,
        }),
      ]);
    },
  );

  it(
    "does not send when another worker already claimed the event",
    async () => {
      emailEventFindManyMock.mockResolvedValue([
        {
          id: "event-race",
          shop:
            "b0z0gt-be.myshopify.com",
          contractId:
            "gid://shopify/SubscriptionContract/123",
          emailType:
            "DAY_30_CHECKIN",
          recipientEmail:
            "customer@example.com",
          idempotencyKey:
            "email-key",
          status: "PENDING",
          dueAt: new Date(),
        },
      ]);

      emailEventUpdateManyMock.mockResolvedValue(
        {
          count: 0,
        },
      );

      const result =
        await processDueLifecycleEmails();

      expect(
        sendLushkaEmailMock,
      ).not.toHaveBeenCalled();

      expect(result.results).toEqual([
        expect.objectContaining({
          eventId: "event-race",
          skipped: true,
          reason: "Already claimed",
        }),
      ]);
    },
  );

  it(
    "returns a failed delivery to PENDING for safe retry",
    async () => {
      emailEventFindManyMock.mockResolvedValue([
        {
          id: "event-retry",
          shop:
            "b0z0gt-be.myshopify.com",
          contractId:
            "gid://shopify/SubscriptionContract/123",
          emailType:
            "DAY_60_FINAL_RITUAL",
          recipientEmail:
            "customer@example.com",
          idempotencyKey:
            "email-retry-key",
          status: "PENDING",
          dueAt: new Date(),
        },
      ]);

      sendLushkaEmailMock.mockRejectedValue(
        new Error(
          "Brevo temporarily unavailable",
        ),
      );

      const result =
        await processDueLifecycleEmails();

      expect(
        emailEventUpdateManyMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data:
            expect.objectContaining({
              status: "PROCESSING",
              attemptCount: {
                increment: 1,
              },
            }),
        }),
      );

      expect(
        emailEventUpdateMock,
      ).toHaveBeenCalledWith({
        where: {
          id: "event-retry",
        },
        data: {
          status: "PENDING",
          error:
            "Brevo temporarily unavailable",
        },
      });

      expect(result.results).toEqual([
        expect.objectContaining({
          eventId: "event-retry",
          emailType:
            "DAY_60_FINAL_RITUAL",
          sent: false,
          error:
            "Brevo temporarily unavailable",
        }),
      ]);
    },
  );
});
