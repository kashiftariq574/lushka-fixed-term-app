import type {
  ReviewFormSubmission,
  ReviewFormSubmissionField,
} from "./review-form-submission.server";
import type { ReviewSignalType } from "./review-signal-idempotency.server";

type RewardSignalType =
  | "DAY_14_REVIEW_REWARD"
  | "DAY_28_REVIEW_PHOTOS_REWARD"
  | "DAY_28_PHOTOS_ONLY_REWARD";

export type ReviewFormContentValidation =
  | {
      valid: true;
    }
  | {
      valid: false;
      reason: string;
    };

function normalizeName(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findField(
  submission: ReviewFormSubmission,
  candidateNames: string[],
): ReviewFormSubmissionField | null {
  const wanted =
    candidateNames.map(normalizeName);

  for (const field of submission.fields) {
    const names = [
      field.key,
      field.definition?.key,
      field.definition?.name,
    ].filter(
      (value): value is string =>
        typeof value === "string",
    );

    if (
      names.some((name) =>
        wanted.includes(
          normalizeName(name),
        ),
      )
    ) {
      return field;
    }
  }

  return null;
}

function hasMeaningfulValue(
  field: ReviewFormSubmissionField | null,
): boolean {
  if (!field) {
    return false;
  }

  if (
    typeof field.value === "string" &&
    field.value.trim()
  ) {
    const normalized =
      field.value.trim().toLowerCase();

    if (
      normalized !== "null" &&
      normalized !== "[]" &&
      normalized !== "{}"
    ) {
      return true;
    }
  }

  const value = field.jsonValue;

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return Boolean(value.trim());
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.keys(value).length > 0;
  }

  return false;
}

function isAffirmativeConsent(
  field: ReviewFormSubmissionField | null,
): boolean {
  if (!field) {
    return false;
  }

  if (field.jsonValue === true) {
    return true;
  }

  const raw =
    typeof field.value === "string"
      ? field.value.trim().toLowerCase()
      : "";

  return [
    "true",
    "yes",
    "1",
    "on",
    "checked",
    "accepted",
  ].includes(raw);
}

function reviewField(
  submission: ReviewFormSubmission,
) {
  return findField(submission, [
    "Review",
    "Your review",
    "Review text",
  ]);
}

function primaryPhotoField(
  submission: ReviewFormSubmission,
) {
  return findField(submission, [
    "Photo 1",
    "Photo1",
    "Image 1",
    "Image1",
    "Photo",
    "Progress photo",
    "Progress image",
  ]);
}

function ownershipConsentField(
  submission: ReviewFormSubmission,
) {
  return findField(submission, [
    "I confirm I own these images and have permission from anyone shown.",
    "I confirm I own these images and have permission from anyone shown",
    "Image ownership consent",
    "Photo ownership consent",
    "Ownership consent",
  ]);
}

export function validateReviewFormContent({
  signalType,
  submission,
}: {
  signalType: ReviewSignalType;
  submission: ReviewFormSubmission;
}): ReviewFormContentValidation {
  const rewardSignal =
    signalType as RewardSignalType;

  if (
    rewardSignal ===
    "DAY_14_REVIEW_REWARD"
  ) {
    if (
      !hasMeaningfulValue(
        reviewField(submission),
      )
    ) {
      return {
        valid: false,
        reason:
          "14-day reward submission is missing the required review",
      };
    }

    return {
      valid: true,
    };
  }

  if (
    rewardSignal ===
    "DAY_28_REVIEW_PHOTOS_REWARD"
  ) {
    if (
      !hasMeaningfulValue(
        reviewField(submission),
      )
    ) {
      return {
        valid: false,
        reason:
          "28-day review + photos submission is missing the required review",
      };
    }

    if (
      !hasMeaningfulValue(
        primaryPhotoField(submission),
      )
    ) {
      return {
        valid: false,
        reason:
          "28-day review + photos submission is missing the required photo",
      };
    }

    if (
      !isAffirmativeConsent(
        ownershipConsentField(submission),
      )
    ) {
      return {
        valid: false,
        reason:
          "28-day review + photos submission is missing required image ownership consent",
      };
    }

    return {
      valid: true,
    };
  }

  if (
    rewardSignal ===
    "DAY_28_PHOTOS_ONLY_REWARD"
  ) {
    if (
      !hasMeaningfulValue(
        primaryPhotoField(submission),
      )
    ) {
      return {
        valid: false,
        reason:
          "28-day photos-only submission is missing the required photo",
      };
    }

    if (
      !isAffirmativeConsent(
        ownershipConsentField(submission),
      )
    ) {
      return {
        valid: false,
        reason:
          "28-day photos-only submission is missing required image ownership consent",
      };
    }

    return {
      valid: true,
    };
  }

  return {
    valid: true,
  };
}
