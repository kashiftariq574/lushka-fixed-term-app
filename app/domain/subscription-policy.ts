export const COMPLETE = {
  code: "COMPLETE_RECOVERY_90",
  baseMinor: 10800,
  discountPct: 25,
  chargeMinor: 8100,
  maxCycles: 3,
  interval: "MONTH" as const,
  intervalCount: 1,
};

export const SERUM = {
  code: "SERUM_RITUAL_90",
  baseMinor: 3500,
  discountPct: 20,
  chargeMinor: 2800,
  maxCycles: 3,
  interval: "MONTH" as const,
  intervalCount: 1,
};

export function discountedMinor(baseMinor: number, percentOff: number): number {
  return Math.round(baseMinor * (1 - percentOff / 100));
}

export function assertBillableCycle(cycleIndex: number): void {
  if (!Number.isInteger(cycleIndex) || cycleIndex < 1) {
    throw new Error("Invalid billing cycle index");
  }
  // Initial storefront checkout is payment #1.
  // Shopify billing cycle 1 = payment #2.
  // Shopify billing cycle 2 = payment #3.
  // Billing cycle 3 would create an unwanted payment #4.
  if (cycleIndex > 2) {
    throw new Error(
      "LUSHKA_FIXED_TERM_COMPLETE: billing cycle 3+ is forbidden after initial checkout",
    );
  }
}

export function isCompleteAfterSuccess(successfulCycles: number): boolean {
  return successfulCycles >= 3;
}

export function deterministicBillingKey(contractId: string, cycleIndex: number): string {
  assertBillableCycle(cycleIndex);
  return `lushka:${contractId}:cycle:${cycleIndex}`;
}
