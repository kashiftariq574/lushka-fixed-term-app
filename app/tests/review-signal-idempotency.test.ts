import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  reviewSignalUpdateManyMock,
} = vi.hoisted(() => ({
  reviewSignalUpdateManyMock: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    reviewSignalEvent: {
      updateMany:
        reviewSignalUpdateManyMock,
    },
  },
}));

import {
  buildReviewRewardKey,
  buildReviewSignalKey,
  markReviewSignalCompleted,
  markReviewSignalRetryable,
} from "../services/review-signal-idempotency.server";

describe(
  "review signal lease safety",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "deduplicates both day-28 request branches to one logical signal key",
      () => {
        const reviewPhotos =
          buildReviewSignalKey({
            shop: "b0z0gt-be.myshopify.com",
            orderId: "gid://shopify/Order/456",
            signalType:
              "DAY_28_REVIEW_PHOTOS_REQUEST",
          });

        const photosOnly =
          buildReviewSignalKey({
            shop: "b0z0gt-be.myshopify.com",
            orderId: "gid://shopify/Order/456",
            signalType:
              "DAY_28_PHOTOS_ONLY_REQUEST",
          });

        expect(reviewPhotos).toBe(
          photosOnly,
        );
      },
    );

    it(
      "deduplicates both day-28 reward branches to one order-stage reward key",
      () => {
        const reviewPhotos =
          buildReviewRewardKey({
            shop: "b0z0gt-be.myshopify.com",
            orderId: "gid://shopify/Order/456",
            signalType:
              "DAY_28_REVIEW_PHOTOS_REWARD",
          });

        const photosOnly =
          buildReviewRewardKey({
            shop: "b0z0gt-be.myshopify.com",
            orderId: "gid://shopify/Order/456",
            signalType:
              "DAY_28_PHOTOS_ONLY_REWARD",
          });

        expect(reviewPhotos).toBe(
          photosOnly,
        );
      },
    );

    it(
      "rejects completion from a worker that lost its attempt lease",
      async () => {
        /*
         * attempt 1 is stale.
         * Another worker has already reclaimed this event as
         * attempt 2, therefore the guarded update affects 0 rows.
         */
        reviewSignalUpdateManyMock.mockResolvedValue({
          count: 0,
        });

        await expect(
          markReviewSignalCompleted({
            eventId: "event-1",
            attemptCount: 1,
          }),
        ).rejects.toThrow(
          "Review signal lease lost",
        );

        expect(
          reviewSignalUpdateManyMock,
        ).toHaveBeenCalledWith({
          where: {
            id: "event-1",
            status: "PROCESSING",
            attemptCount: 1,
          },
          data: {
            status: "COMPLETED",
            processingStartedAt: null,
            lastError: null,
            processedAt:
              expect.any(Date),
          },
        });
      },
    );

    it(
      "allows the current lease owner to complete the event",
      async () => {
        reviewSignalUpdateManyMock.mockResolvedValue({
          count: 1,
        });

        await expect(
          markReviewSignalCompleted({
            eventId: "event-1",
            attemptCount: 2,
          }),
        ).resolves.toBeUndefined();

        expect(
          reviewSignalUpdateManyMock,
        ).toHaveBeenCalledWith({
          where: {
            id: "event-1",
            status: "PROCESSING",
            attemptCount: 2,
          },
          data: {
            status: "COMPLETED",
            processingStartedAt: null,
            lastError: null,
            processedAt:
              expect.any(Date),
          },
        });
      },
    );

    it(
      "does not let a stale worker move a reclaimed event back to RETRYABLE",
      async () => {
        reviewSignalUpdateManyMock.mockResolvedValue({
          count: 0,
        });

        await expect(
          markReviewSignalRetryable({
            eventId: "event-1",
            attemptCount: 1,
            error: "old worker failed",
          }),
        ).rejects.toThrow(
          "Review signal lease lost",
        );
      },
    );
  },
);
