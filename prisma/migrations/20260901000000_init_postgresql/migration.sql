-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopConfig" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractState" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT,
    "planType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "successfulCycleCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessfulCycle" INTEGER,
    "lastOrderId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextBillingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL,
    "contractStateId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "shopifyBillingAttemptId" TEXT,
    "shopifyOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryProcess" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuationEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContinuationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "orderId" TEXT,
    "emailType" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_idempotencyKey_key" ON "EmailEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailEvent_shop_idx" ON "EmailEvent"("shop");

-- CreateIndex
CREATE INDEX "EmailEvent_status_idx" ON "EmailEvent"("status");

-- CreateIndex
CREATE INDEX "EmailEvent_dueAt_idx" ON "EmailEvent"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_contractId_emailType_key" ON "EmailEvent"("contractId", "emailType");

-- AddForeignKey
ALTER TABLE "BillingAttempt" ADD CONSTRAINT "BillingAttempt_contractStateId_fkey" FOREIGN KEY ("contractStateId") REFERENCES "ContractState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

