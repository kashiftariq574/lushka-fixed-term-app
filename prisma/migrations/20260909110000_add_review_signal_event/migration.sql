-- CreateTable
CREATE TABLE "ReviewSignalEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "readyTag" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "metaobjectHandle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processingStartedAt" TIMESTAMP(3),
    "discountCode" TEXT,
    "rewardKey" TEXT,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSignalEvent_signalKey_key"
ON "ReviewSignalEvent"("signalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSignalEvent_rewardKey_key"
ON "ReviewSignalEvent"("rewardKey");

-- CreateIndex
CREATE INDEX "ReviewSignalEvent_shop_orderId_idx"
ON "ReviewSignalEvent"("shop", "orderId");

-- CreateIndex
CREATE INDEX "ReviewSignalEvent_shop_status_idx"
ON "ReviewSignalEvent"("shop", "status");

-- CreateIndex
CREATE INDEX "ReviewSignalEvent_status_idx"
ON "ReviewSignalEvent"("status");

-- CreateIndex
CREATE INDEX "ReviewSignalEvent_processingStartedAt_idx"
ON "ReviewSignalEvent"("processingStartedAt");
