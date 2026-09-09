import type { ReviewSignalType } from "./review-signal-idempotency.server";

export type ReviewSignalFinalState = {
  successTags: string[];
};

export function reviewSignalFinalState(
  signalType: ReviewSignalType,
): ReviewSignalFinalState {
  switch (signalType) {
    case "DAY_14_REVIEW_REQUEST":
      return {
        successTags: [
          "lushka-14-review-request-sent",
        ],
      };

    case "DAY_28_PHOTOS_ONLY_REQUEST":
    case "DAY_28_REVIEW_PHOTOS_REQUEST":
      return {
        successTags: [
          "lushka-28-review-request-sent",
        ],
      };

    case "DAY_14_REVIEW_REWARD":
      return {
        successTags: [
          "lushka-14-review-completed",
        ],
      };

    case "DAY_28_REVIEW_PHOTOS_REWARD":
    case "DAY_28_PHOTOS_ONLY_REWARD":
      return {
        successTags: [
          "lushka-28-review-completed",
        ],
      };
  }
}
