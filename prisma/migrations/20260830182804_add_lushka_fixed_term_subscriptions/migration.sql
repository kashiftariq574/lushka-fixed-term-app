-- CreateTable
CREATE TABLE "ShopConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "completeParentProductId" TEXT,
    "completeParentVariantId" TEXT,
    "serumVariantId" TEXT,
    "shampooVariantId" TEXT,
    "conditionerVariantId" TEXT,
    "maskVariantId" TEXT,
    "oilVariantId" TEXT,
    "massagerVariantId" TEXT,
    "locationId" TEXT,
    "completeSellingPlanGroupId" TEXT,
    "completeSellingPlanId" TEXT,
    "serumSellingPlanGroupId" TEXT,
    "serumSellingPlanId" TEXT,
    "shippingMode" TEXT NOT NULL DEFAULT 'SHOPIFY_CHECKOUT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContractState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT,
    "planType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "successfulCycleCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessfulCycle" INTEGER,
    "lastOrderId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextBillingAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractStateId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "shopifyBillingAttemptId" TEXT,
    "shopifyOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingAttempt_contractStateId_fkey" FOREIGN KEY ("contractStateId") REFERENCES "ContractState" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryProcess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContinuationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopConfig_shop_key" ON "ShopConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ContractState_contractId_key" ON "ContractState"("contractId");

-- CreateIndex
CREATE INDEX "ContractState_shop_idx" ON "ContractState"("shop");

-- CreateIndex
CREATE INDEX "ContractState_status_idx" ON "ContractState"("status");

-- CreateIndex
CREATE INDEX "ContractState_nextBillingAt_idx" ON "ContractState"("nextBillingAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_idempotencyKey_key" ON "BillingAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingAttempt_status_idx" ON "BillingAttempt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_contractId_cycleIndex_key" ON "BillingAttempt"("contractId", "cycleIndex");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryProcess_idempotencyKey_key" ON "InventoryProcess"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryProcess_shop_idx" ON "InventoryProcess"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryProcess_shop_orderId_planType_key" ON "InventoryProcess"("shop", "orderId", "planType");

-- CreateIndex
CREATE UNIQUE INDEX "ContinuationEvent_contractId_key" ON "ContinuationEvent"("contractId");

-- CreateIndex
CREATE INDEX "ContinuationEvent_shop_idx" ON "ContinuationEvent"("shop");

-- CreateIndex
CREATE INDEX "ContinuationEvent_dueAt_idx" ON "ContinuationEvent"("dueAt");

-- CreateIndex
CREATE INDEX "ContinuationEvent_status_idx" ON "ContinuationEvent"("status");
