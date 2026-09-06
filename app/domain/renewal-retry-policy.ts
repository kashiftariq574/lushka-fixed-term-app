export const MAX_ATTEMPTS_PER_CYCLE = 3;

// TESTING:
// Change this to 5 minutes before production launch.
export const RETRY_DELAY_MS = 2 * 60 * 1000;

export function retryAvailableAt(
  failedAttemptUpdatedAt: Date,
): Date {
  return new Date(
    failedAttemptUpdatedAt.getTime() + RETRY_DELAY_MS,
  );
}

export function hasReachedMaxAttempts(
  attemptCount: number,
): boolean {
  return attemptCount >= MAX_ATTEMPTS_PER_CYCLE;
}

export function isRetryReady(
  failedAttemptUpdatedAt: Date,
  now: Date,
): boolean {
  return now.getTime() >= retryAvailableAt(failedAttemptUpdatedAt).getTime();
}
