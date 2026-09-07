-- Add 72-hour payment-hold tracking to fixed-term subscription contracts.
ALTER TABLE "ContractState"
ADD COLUMN "paymentHoldStartedAt" TIMESTAMP(3),
ADD COLUMN "paymentHoldUntil" TIMESTAMP(3);

CREATE INDEX "ContractState_paymentHoldUntil_idx"
ON "ContractState"("paymentHoldUntil");

-- Track future programme stock reserved for each subscription contract.
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reservedQuantity" INTEGER NOT NULL,
    "reservationAttempt" INTEGER NOT NULL DEFAULT 1,
    "consumptionAttempt" INTEGER NOT NULL DEFAULT 1,
    "consumedQuantity" INTEGER NOT NULL DEFAULT 0,
    "releasedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryReservation_contractId_variantId_key"
ON "InventoryReservation"("contractId", "variantId");

CREATE INDEX "InventoryReservation_shop_idx"
ON "InventoryReservation"("shop");

CREATE INDEX "InventoryReservation_contractId_idx"
ON "InventoryReservation"("contractId");

CREATE INDEX "InventoryReservation_status_idx"
ON "InventoryReservation"("status");

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_contractId_fkey"
FOREIGN KEY ("contractId")
REFERENCES "ContractState"("contractId")
ON DELETE CASCADE
ON UPDATE CASCADE;
