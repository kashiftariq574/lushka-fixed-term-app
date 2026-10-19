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
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
}));

vi.mock("../db.server", () => ({
  default: {
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
    contractState: {
      upsert: contractStateUpsert,
    },
    inventoryProcess: {
      findUnique: inventoryFindUnique,
      upsert: inventoryUpsert,
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
  scheduleLifecycleEmails:
    scheduleLifecycleEmailsMock,
  scheduleRootRevivalLifecycleEmails:
    scheduleRootRevivalLifecycleEmailsMock,
}));

import { action } from "../routes/webhooks.subscription_contracts.create";

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

function mockWebhook() {
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
}

function mockContract(quantity = 1) {
  adminGraphqlMock.mockResolvedValue({
    json: async () => ({
      data: {
        subscriptionContract: {
          id: contractId,
          status: "ACTIVE",
          createdAt: "2026-09-07T00:00:00.000Z",
          nextBillingDate: "2026-10-07T00:00:00.000Z",
          customer: {
            id: "gid://shopify/Customer/789",
            firstName: "Samantha",
            defaultEmailAddress: {
              emailAddress:
                "customer@example.com",
            },
          },
          lines: {
            nodes: [
              {
                sellingPlanId: config.completeSellingPlanId,
                quantity,
              },
            ],
          },
        },
      },
    }),
  });
}

function mockRootRevivalContract(
  sellingPlanId = config.rootRevival4WeekSellingPlanId,
) {
  adminGraphqlMock.mockResolvedValue({
    json: async () => ({
      data: {
        subscriptionContract: {
          id: contractId,
          status: "ACTIVE",
          createdAt: "2026-09-07T00:00:00.000Z",
          nextBillingDate: "2026-10-05T00:00:00.000Z",
          customer: {
            id: "gid://shopify/Customer/789",
            firstName: "Samantha",
            defaultEmailAddress: {
              emailAddress: "customer@example.com",
            },
          },
          lines: {
            nodes: [
              {
                sellingPlanId,
                quantity: 1,
              },
            ],
          },
        },
      },
    }),
  });
}

describe("subscription contract create webhook safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockWebhook();
    mockContract();

    shopConfigFindUnique.mockResolvedValue(config);
    contractStateUpsert.mockResolvedValue({});
    inventoryFindUnique.mockResolvedValue(null);
    inventoryUpsert.mockResolvedValue({});
    deductInventoryMock.mockResolvedValue(undefined);
    reserveCompleteFutureInventoryMock.mockResolvedValue(undefined);

    scheduleLifecycleEmailsMock.mockResolvedValue({
      scheduled: 4,
    });

    scheduleRootRevivalLifecycleEmailsMock.mockResolvedValue({
      scheduled: 4,
      intervalWeeks: 4,
    });
  });

  it("processes Complete plan initial inventory including the massager", async () => {
    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(contractStateUpsert).toHaveBeenCalled();

    expect(deductInventoryMock).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
        config.maskVariantId,
        config.oilVariantId,
        config.massagerVariantId,
      ],
      locationId: config.locationId,
      idempotencyKey: `inventory:initial:${contractId}`,
      referenceDocumentUri: "lushka://subscription/123/initial",
    });

    expect(inventoryUpsert).toHaveBeenCalledWith({
      where: {
        idempotencyKey: `initial:${contractId}`,
      },
      update: {},
      create: {
        shop,
        orderId: originOrderId,
        planType: "COMPLETE_RECOVERY_90",
        idempotencyKey: `initial:${contractId}`,
      },
    });

    expect(
      reserveCompleteFutureInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      shop,
      contractId,
      planType: "COMPLETE_RECOVERY_90",
      locationId: config.locationId,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
        config.maskVariantId,
        config.oilVariantId,
      ],
      unitsPerVariant: 2,
    });

    expect(
      scheduleLifecycleEmailsMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      scheduleLifecycleEmailsMock,
    ).toHaveBeenCalledWith({
      shop,
      contractId,
      recipientEmail:
        "customer@example.com",
      startedAt: new Date(
        "2026-09-07T00:00:00.000Z",
      ),
    });
  });

  it("processes Root Revival initial inventory and reserves two future deliveries", async () => {
    mockRootRevivalContract();

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(deductInventoryMock).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
      ],
      locationId: config.locationId,
      idempotencyKey: `inventory:initial:${contractId}`,
      referenceDocumentUri: "lushka://subscription/123/initial",
    });

    expect(inventoryUpsert).toHaveBeenCalledWith({
      where: {
        idempotencyKey: `initial:${contractId}`,
      },
      update: {},
      create: {
        shop,
        orderId: originOrderId,
        planType: "ROOT_REVIVAL_TRIO",
        idempotencyKey: `initial:${contractId}`,
      },
    });

    expect(
      reserveCompleteFutureInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      shop,
      contractId,
      planType: "ROOT_REVIVAL_TRIO",
      locationId: config.locationId,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
      ],
      unitsPerVariant: 2,
    });

    expect(
      scheduleRootRevivalLifecycleEmailsMock,
    ).toHaveBeenCalledWith({
      shop,
      contractId,
      recipientEmail: "customer@example.com",
      startedAt: new Date(
        "2026-09-07T00:00:00.000Z",
      ),
      intervalWeeks: 4,
    });

    expect(
      scheduleLifecycleEmailsMock,
    ).not.toHaveBeenCalled();
  });

  it("does not deduct inventory again when initial inventory was already processed", async () => {
    inventoryFindUnique.mockResolvedValue({
      id: "inventory-process-1",
      idempotencyKey: `initial:${contractId}`,
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();

    // Reservation reconciliation must still run independently of
    // initial-delivery inventory idempotency.
    expect(
      reserveCompleteFutureInventoryMock,
    ).toHaveBeenCalledTimes(1);
  });

  it("rejects a LUSHKA subscription quantity greater than one", async () => {
    mockContract(2);

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(422);
    expect(contractStateUpsert).not.toHaveBeenCalled();
    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();
    expect(
      reserveCompleteFutureInventoryMock,
    ).not.toHaveBeenCalled();
  });

  it("processes Serum Ritual initial inventory with serum only", async () => {
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
                  sellingPlanId: config.serumSellingPlanId,
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(
      reserveCompleteFutureInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      shop,
      contractId,
      planType: "SERUM_RITUAL_90",
      locationId: config.locationId,
      variantIds: [config.serumVariantId],
      unitsPerVariant: 2,
    });

    expect(inventoryUpsert).toHaveBeenCalledWith({
      where: {
        idempotencyKey: `initial:${contractId}`,
      },
      update: {},
      create: {
        shop,
        orderId: originOrderId,
        planType: "SERUM_RITUAL_90",
        idempotencyKey: `initial:${contractId}`,
      },
    });
  });

  it("still reconciles Serum future reservation when initial inventory was already processed", async () => {
    inventoryFindUnique.mockResolvedValue({
      id: "inventory-process-1",
      idempotencyKey: `initial:${contractId}`,
    });

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
                  sellingPlanId: config.serumSellingPlanId,
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();
    expect(
      reserveCompleteFutureInventoryMock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        planType: "SERUM_RITUAL_90",
        unitsPerVariant: 2,
        variantIds: [config.serumVariantId],
      }),
    );
  });

});
