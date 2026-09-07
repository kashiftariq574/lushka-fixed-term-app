import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateWebhookMock,
  adminGraphqlMock,
  inventoryFindUnique,
  inventoryUpsert,
  shopConfigFindUnique,
  contractStateFindUnique,
  contractStateUpdate,
  billingUpdateMany,
  deductInventoryMock,
} = vi.hoisted(() => ({
  authenticateWebhookMock: vi.fn(),
  adminGraphqlMock: vi.fn(),
  inventoryFindUnique: vi.fn(),
  inventoryUpsert: vi.fn(),
  shopConfigFindUnique: vi.fn(),
  contractStateFindUnique: vi.fn(),
  contractStateUpdate: vi.fn(),
  billingUpdateMany: vi.fn(),
  deductInventoryMock: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: authenticateWebhookMock,
  },
}));

vi.mock("../db.server", () => ({
  default: {
    inventoryProcess: {
      findUnique: inventoryFindUnique,
      upsert: inventoryUpsert,
    },
    shopConfig: {
      findUnique: shopConfigFindUnique,
    },
    contractState: {
      findUnique: contractStateFindUnique,
      update: contractStateUpdate,
    },
    billingAttempt: {
      updateMany: billingUpdateMany,
    },
  },
}));

vi.mock("../services/inventory.server", () => ({
  deductVariantInventory: deductInventoryMock,
}));

import { action } from "../routes/webhooks.subscription_billing_attempts.success";

const shop = "b0z0gt-be.myshopify.com";
const contractId = "gid://shopify/SubscriptionContract/123";
const orderId = "gid://shopify/Order/456";
const billingKey = `lushka:${contractId}:cycle:1`;

function mockWebhook() {
  authenticateWebhookMock.mockResolvedValue({
    admin: {
      graphql: adminGraphqlMock,
    },
    payload: {
      idempotency_key: billingKey,
      admin_graphql_api_order_id: orderId,
      admin_graphql_api_subscription_contract_id: contractId,
      ready: true,
    },
    shop,
    topic: "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS",
    session: {
      id: "offline_b0z0gt-be.myshopify.com",
    },
  });
}

describe("subscription billing success webhook safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhook();

    billingUpdateMany.mockResolvedValue({ count: 1 });
    inventoryUpsert.mockResolvedValue({});
    contractStateUpdate.mockResolvedValue({});
    deductInventoryMock.mockResolvedValue(undefined);
  });

  it("skips duplicate inventory processing for an already processed billing key", async () => {
    inventoryFindUnique.mockResolvedValue({
      id: "inventory-process-1",
      idempotencyKey: billingKey,
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(shopConfigFindUnique).not.toHaveBeenCalled();
    expect(adminGraphqlMock).not.toHaveBeenCalled();
    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(contractStateUpdate).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();
  });

  it("ignores stale success without deducting inventory or regressing contract state", async () => {
    inventoryFindUnique.mockResolvedValue(null);

    shopConfigFindUnique.mockResolvedValue({
      locationId: "gid://shopify/Location/1",
      completeSellingPlanId: "gid://shopify/SellingPlan/complete",
      serumSellingPlanId: "gid://shopify/SellingPlan/serum",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
      maskVariantId: "gid://shopify/ProductVariant/mask",
      oilVariantId: "gid://shopify/ProductVariant/oil",
    });

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2026-10-07T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: "gid://shopify/SellingPlan/complete",
                  variantId: "gid://shopify/ProductVariant/parent",
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    contractStateFindUnique.mockResolvedValue({
      contractId,
      successfulCycleCount: 2,
      nextBillingAt: new Date("2026-10-07T00:00:00.000Z"),
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(contractStateUpdate).not.toHaveBeenCalled();
    expect(inventoryUpsert).not.toHaveBeenCalled();

    expect(billingUpdateMany).toHaveBeenCalledWith({
      where: {
        idempotencyKey: billingKey,
      },
      data: {
        status: "SUCCESS",
        shopifyOrderId: orderId,
        error: null,
      },
    });
  });

  it("processes payment #2 for Complete plan without the massager", async () => {
    inventoryFindUnique.mockResolvedValue(null);

    const config = {
      locationId: "gid://shopify/Location/1",
      completeSellingPlanId: "gid://shopify/SellingPlan/complete",
      serumSellingPlanId: "gid://shopify/SellingPlan/serum",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
      maskVariantId: "gid://shopify/ProductVariant/mask",
      oilVariantId: "gid://shopify/ProductVariant/oil",
      massagerVariantId: "gid://shopify/ProductVariant/massager",
    };

    shopConfigFindUnique.mockResolvedValue(config);

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2026-11-07T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: config.completeSellingPlanId,
                  variantId: "gid://shopify/ProductVariant/parent",
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    contractStateFindUnique.mockResolvedValue({
      contractId,
      successfulCycleCount: 1,
      nextBillingAt: new Date("2026-10-07T00:00:00.000Z"),
    });

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
        config.maskVariantId,
        config.oilVariantId,
      ],
      locationId: config.locationId,
      idempotencyKey: `inventory:${billingKey}`,
      referenceDocumentUri: "lushka://subscription/123/cycle/1",
    });

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        successfulCycleCount: 2,
        lastSuccessfulCycle: 1,
        lastOrderId: orderId,
        status: "ACTIVE",
        completedAt: null,
        nextBillingAt: new Date("2026-11-07T00:00:00.000Z"),
      },
    });
  });

  it("completes the contract after payment #3 and clears next billing", async () => {
    const cycleTwoBillingKey = `lushka:${contractId}:cycle:2`;

    authenticateWebhookMock.mockResolvedValue({
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {
        idempotency_key: cycleTwoBillingKey,
        admin_graphql_api_order_id: orderId,
        admin_graphql_api_subscription_contract_id: contractId,
        ready: true,
      },
      shop,
      topic: "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS",
      session: {
        id: "offline_b0z0gt-be.myshopify.com",
      },
    });

    inventoryFindUnique.mockResolvedValue(null);

    const config = {
      locationId: "gid://shopify/Location/1",
      completeSellingPlanId: "gid://shopify/SellingPlan/complete",
      serumSellingPlanId: "gid://shopify/SellingPlan/serum",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
      maskVariantId: "gid://shopify/ProductVariant/mask",
      oilVariantId: "gid://shopify/ProductVariant/oil",
      massagerVariantId: "gid://shopify/ProductVariant/massager",
    };

    shopConfigFindUnique.mockResolvedValue(config);

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2026-12-07T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: config.completeSellingPlanId,
                  variantId: "gid://shopify/ProductVariant/parent",
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    contractStateFindUnique.mockResolvedValue({
      contractId,
      successfulCycleCount: 2,
      nextBillingAt: new Date("2026-11-07T00:00:00.000Z"),
    });

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
        config.maskVariantId,
        config.oilVariantId,
      ],
      locationId: config.locationId,
      idempotencyKey: `inventory:${cycleTwoBillingKey}`,
      referenceDocumentUri: "lushka://subscription/123/cycle/2",
    });

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        successfulCycleCount: 3,
        lastSuccessfulCycle: 2,
        lastOrderId: orderId,
        status: "COMPLETED",
        completedAt: expect.any(Date),
        nextBillingAt: null,
      },
    });
  });


  it("processes Serum Ritual payment #2 with serum inventory only", async () => {
    inventoryFindUnique.mockResolvedValue(null);

    const config = {
      locationId: "gid://shopify/Location/1",
      completeSellingPlanId: "gid://shopify/SellingPlan/complete",
      serumSellingPlanId: "gid://shopify/SellingPlan/serum",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
      maskVariantId: "gid://shopify/ProductVariant/mask",
      oilVariantId: "gid://shopify/ProductVariant/oil",
      massagerVariantId: "gid://shopify/ProductVariant/massager",
    };

    shopConfigFindUnique.mockResolvedValue(config);

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2026-11-07T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: config.serumSellingPlanId,
                  variantId: config.serumVariantId,
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    contractStateFindUnique.mockResolvedValue({
      contractId,
      successfulCycleCount: 1,
      nextBillingAt: new Date("2026-10-07T00:00:00.000Z"),
    });

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
      ],
      locationId: config.locationId,
      idempotencyKey: `inventory:${billingKey}`,
      referenceDocumentUri: "lushka://subscription/123/cycle/1",
    });

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        successfulCycleCount: 2,
        lastSuccessfulCycle: 1,
        lastOrderId: orderId,
        status: "ACTIVE",
        completedAt: null,
        nextBillingAt: new Date("2026-11-07T00:00:00.000Z"),
      },
    });
  });

  it("completes Serum Ritual after payment #3 with serum inventory only", async () => {
    const cycleTwoBillingKey = `lushka:${contractId}:cycle:2`;

    authenticateWebhookMock.mockResolvedValue({
      admin: {
        graphql: adminGraphqlMock,
      },
      payload: {
        idempotency_key: cycleTwoBillingKey,
        admin_graphql_api_order_id: orderId,
        admin_graphql_api_subscription_contract_id: contractId,
        ready: true,
      },
      shop,
      topic: "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS",
      session: {
        id: "offline_b0z0gt-be.myshopify.com",
      },
    });

    inventoryFindUnique.mockResolvedValue(null);

    const config = {
      locationId: "gid://shopify/Location/1",
      completeSellingPlanId: "gid://shopify/SellingPlan/complete",
      serumSellingPlanId: "gid://shopify/SellingPlan/serum",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
      maskVariantId: "gid://shopify/ProductVariant/mask",
      oilVariantId: "gid://shopify/ProductVariant/oil",
      massagerVariantId: "gid://shopify/ProductVariant/massager",
    };

    shopConfigFindUnique.mockResolvedValue(config);

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2026-12-07T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: config.serumSellingPlanId,
                  variantId: config.serumVariantId,
                  quantity: 1,
                },
              ],
            },
          },
        },
      }),
    });

    contractStateFindUnique.mockResolvedValue({
      contractId,
      successfulCycleCount: 2,
      nextBillingAt: new Date("2026-11-07T00:00:00.000Z"),
    });

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
      ],
      locationId: config.locationId,
      idempotencyKey: `inventory:${cycleTwoBillingKey}`,
      referenceDocumentUri: "lushka://subscription/123/cycle/2",
    });

    expect(contractStateUpdate).toHaveBeenCalledWith({
      where: {
        contractId,
      },
      data: {
        successfulCycleCount: 3,
        lastSuccessfulCycle: 2,
        lastOrderId: orderId,
        status: "COMPLETED",
        completedAt: expect.any(Date),
        nextBillingAt: null,
      },
    });
  });

});
