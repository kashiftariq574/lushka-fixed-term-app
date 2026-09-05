DROP INDEX IF EXISTS "BillingAttempt_contractId_cycleIndex_key";

CREATE INDEX IF NOT EXISTS "BillingAttempt_contractId_cycleIndex_idx"
ON "BillingAttempt"("contractId", "cycleIndex");

CREATE UNIQUE INDEX IF NOT EXISTS "BillingAttempt_contractId_cycleIndex_attemptCount_key"
ON "BillingAttempt"("contractId", "cycleIndex", "attemptCount");
