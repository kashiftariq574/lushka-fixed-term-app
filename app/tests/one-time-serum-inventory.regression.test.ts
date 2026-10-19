import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateWebhookMock,
  adminGraphqlMock,
  shopConfigFindUnique,
  contractStateUpsert,
  inventoryFindUnique,
  inventoryUpsert,
  deductInventoryMock,
  reserveCompleteFutureInventoryMock,
  scheduleLifecycleEmailsMock,
  scheduleRootRevivalLifecycleEmailsMock,
  contractFindMany,
  billingFindMany,
  billingCreate,
  billingUpdateMany,
  contractUpdate,
  contractUpdateMany,
  adminMock,
  createBillingAttemptMock,
  prepareSerumMock,
  restoreSerumMock,
} = vi.hoisted(() => ({
  authenticateWebhookMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  contractStateUpsert: vi.fn(),
  inventoryFindUnique: vi.fn(),
  inventoryUpsert: vi.fn(),
  deductInventoryMock: vi.fn(),
  reserveCompleteFutureInventoryMock: vi.fn(),
  scheduleLifecycleEmailsMock: vi.fn(),
  scheduleRootRevivalLifecycleEmailsMock: vi.fn(),
  contractFindMany: vi.fn(),
  billingFindMany: vi.fn(),
  billingCreate: vi.fn(),
  billingUpdateMany: vi.fn(),
  contractUpdate: vi.fn(),
  contractUpdateMany: vi.fn(),
  adminMock: vi.fn(),
  createBillingAttemptMock: vi.fn(),
  prepareSerumMock: vi.fn(),
  restoreSerumMock: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
  unauthenticated: {
    admin: adminMock,
  },
}));

vi.mock("../db.server", () => ({
  default: {
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
    contractState: {
      upsert: contractStateUpsert,
      findMany: contractFindMany,
      update: contractUpdate,
      updateMany: contractUpdateMany,
    },
    inventoryProcess: {
      findUnique: inventoryFindUnique,
      upsert: inventoryUpsert,
    },
    billingAttempt: {
      findMany: billingFindMany,
      create: billingCreate,
      updateMany: billingUpdateMany,
    },
  },
}));

vi.mock("../services/inventory.server", () => ({
  deductVariantInventory: deductInventoryMock,
}));

vi.mock("../services/program-inventory-reservations.server", () => ({
  reserveCompleteFutureInventory: reserveCompleteFutureInventoryMock,
}));

vi.mock("../services/lifecycle-email-events.server", () => ({
  scheduleLifecycleEmails: scheduleLifecycleEmailsMock,
  scheduleRootRevivalLifecycleEmails:
    scheduleRootRevivalLifecycleEmailsMock,
}));

vi.mock("../services/billing.server", async () => {
  const actual = await vi.importActual<
    typeof import("../services/billing.server")
  >("../services/billing.server");

  return {
    ...actual,
    createBillingAttempt: createBillingAttemptMock,
  };
});

vi.mock("../services/serum-inventory-reservation.server", () => ({
  prepareSerumReservedInventoryForBilling: prepareSerumMock,
  restoreSerumReservedInventoryAfterFailedBilling: restoreSerumMock,
  markSerumReservedInventoryConsumed: vi.fn(),
  releaseSerumRemainingInventory: vi.fn(),
}));

import { action as createContractAction } from "../routes/webhooks.subscription_contracts.create";
import { processDueRenewals } from "../services/renewals.server";
import { COMPLETE } from "../domain/subscription-policy";

const shop = "b0z0gt-be.myshopify.com";
const contractId = "gid://shopify/SubscriptionContract/123";
const originOrderId = "gid://shopify/Order/456";

const config = {
  locationId: "gid://shopify/Location/1",
  completeSellingPlanId: "gid://shopify/SellingPlan/complete",
  serumSellingPlanId: "gid://shopify/SellingPlan/serum",
  rootRevival4WeekSellingPlanId: "gid://shopify/SellingPlan/root-4",
  rootRevival6WeekSellingPlanId: "gid://shopify/SellingPlan/root-6",
  rootRevival8WeekSellingPlanId: "gid://shopify/SellingPlan/root-8",
  serumVariantId: "gid://shopify/ProductVariant/serum",
  shampooVariantId: "gid://shopify/ProductVariant/shampoo",
  conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
  maskVariantId: "gid://shopify/ProductVariant/mask",
  oilVariantId: "gid://shopify/ProductVariant/oil",
  massagerVariantId: "gid://shopify/ProductVariant/massager",
};

describe("one-time Serum purchase inventory isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps orders/updated on Shopify-native inventory only (no subscription reservation hooks)", () => {
    const routePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../routes/webhooks.orders.updated.tsx",
    );
    const source = readFileSync(routePath, "utf8");

    expect(source).not.toMatch(/serum-inventory-reservation/);
    expect(source).not.toMatch(/reserveCompleteFutureInventory/);
    expect(source).not.toMatch(/inventory-reservations\.server/);
    expect(source).not.toMatch(/deductVariantInventory/);
    expect(source).not.toMatch(/InventoryReservation/);
    expect(source).not.toMatch(/SERUM_RITUAL_90/);
  });

  it("does not create Serum reservations unless the SERUM_RITUAL_90 selling plan is present", async () => {
    authenticateWebhookMock.mockResolvedValue({
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {
        admin_graphql_api_id: contractId,
        admin_graphql_api_customer_id: "gid://shopify/Customer/789",
        admin_graphql_api_origin_order_id: originOrderId,
        status: "ACTIVE",
      },
      shop,
      topic: "SUBSCRIPTION_CONTRACTS_CREATE",
    });

    shopConfigFindUnique.mockResolvedValue(config);
    inventoryFindUnique.mockResolvedValue(null);
    contractStateUpsert.mockResolvedValue({});
    inventoryUpsert.mockResolvedValue({});

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            status: "ACTIVE",
            nextBillingDate: "2026-10-07T00:00:00.000Z",
            customer: {
              id: "gid://shopify/Customer/789",
            },
            lines: {
              nodes: [
                {
                  // Serum product without the ritual selling plan must not
                  // enter SERUM_RITUAL_90 reservation logic.
                  sellingPlanId: "gid://shopify/SellingPlan/unrelated",
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    const response = await createContractAction({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    // Without a LUSHKA selling plan, create short-circuits before any
    // ContractState / InventoryReservation / inventory mutation work.
    expect(response.status).toBe(422);
    expect(contractStateUpsert).not.toHaveBeenCalled();
    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();
    expect(
      reserveCompleteFutureInventoryMock,
    ).not.toHaveBeenCalled();
  });

  it("does not release/prepare Serum reservations for Complete renewals", async () => {
    contractFindMany.mockResolvedValue([
      {
        id: "state-1",
        shop,
        contractId,
        planType: COMPLETE.code,
        successfulCycleCount: 1,
        nextBillingAt: new Date("2026-09-06T12:00:00.000Z"),
        status: "ACTIVE",
      },
    ]);
    billingFindMany.mockResolvedValue([]);
    billingCreate.mockResolvedValue({
      id: "attempt-1",
      contractStateId: "state-1",
      contractId,
      cycleIndex: 1,
      idempotencyKey: `lushka:${contractId}:cycle:1`,
      status: "PENDING",
      attemptCount: 1,
    });
    adminMock.mockResolvedValue({
      admin: {
        graphql: vi.fn(),
      },
    });
    createBillingAttemptMock.mockResolvedValue({
      attempt: {
        id: "gid://shopify/SubscriptionBillingAttempt/1",
        ready: true,
        order: null,
        errorMessage: null,
      },
    });
    billingUpdateMany.mockResolvedValue({ count: 1 });

    await processDueRenewals(new Date("2026-09-06T12:10:00.000Z"));

    expect(prepareSerumMock).not.toHaveBeenCalled();
    expect(restoreSerumMock).not.toHaveBeenCalled();
    expect(billingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "PENDING",
      }),
    });
  });
});
