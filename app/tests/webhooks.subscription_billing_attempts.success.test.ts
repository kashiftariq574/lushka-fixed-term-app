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
  consumeCompleteReservedInventoryMock,
  markSerumReservedInventoryConsumedMock,
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
  consumeCompleteReservedInventoryMock: vi.fn(),
  markSerumReservedInventoryConsumedMock: vi.fn(),
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

vi.mock("../services/program-inventory-consumption.server", () => ({
  consumeCompleteReservedInventory:
    consumeCompleteReservedInventoryMock,
}));

vi.mock("../services/serum-inventory-reservation.server", () => ({
  markSerumReservedInventoryConsumed:
    markSerumReservedInventoryConsumedMock,
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
    consumeCompleteReservedInventoryMock.mockResolvedValue({
      consumed: 5,
      skipped: false,
    });
    markSerumReservedInventoryConsumedMock.mockResolvedValue({
      consumed: 1,
      skipped: false,
    });
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
    expect(
      consumeCompleteReservedInventoryMock,
    ).not.toHaveBeenCalled();
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
    expect(
      consumeCompleteReservedInventoryMock,
    ).not.toHaveBeenCalled();
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

    expect(deductInventoryMock).not.toHaveBeenCalled();

    expect(
      consumeCompleteReservedInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId,
      locationId: config.locationId,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
        config.maskVariantId,
        config.oilVariantId,
      ],
      cycleIndex: 1,
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

  it("processes Root Revival payment #2 using reserved trio inventory", async () => {
    inventoryFindUnique.mockResolvedValue(null);

    const config = {
      locationId: "gid://shopify/Location/1",
      rootRevival4WeekSellingPlanId: "gid://shopify/SellingPlan/root-4",
      rootRevival6WeekSellingPlanId: "gid://shopify/SellingPlan/root-6",
      rootRevival8WeekSellingPlanId: "gid://shopify/SellingPlan/root-8",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
    };

    shopConfigFindUnique.mockResolvedValue(config);

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2026-11-02T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: config.rootRevival4WeekSellingPlanId,
                  variantId: "gid://shopify/ProductVariant/root-parent",
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
      nextBillingAt: new Date("2026-10-05T00:00:00.000Z"),
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(
      consumeCompleteReservedInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId,
      locationId: config.locationId,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
      ],
      cycleIndex: 1,
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
        nextBillingAt: new Date("2026-11-02T00:00:00.000Z"),
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

    expect(deductInventoryMock).not.toHaveBeenCalled();

    expect(
      consumeCompleteReservedInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId,
      locationId: config.locationId,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
        config.maskVariantId,
        config.oilVariantId,
      ],
      cycleIndex: 2,
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


  it("completes Root Revival after payment #3 using reserved trio inventory", async () => {
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
      rootRevival4WeekSellingPlanId: "gid://shopify/SellingPlan/root-4",
      rootRevival6WeekSellingPlanId: "gid://shopify/SellingPlan/root-6",
      rootRevival8WeekSellingPlanId: "gid://shopify/SellingPlan/root-8",
      serumVariantId: "gid://shopify/ProductVariant/serum",
      shampooVariantId: "gid://shopify/ProductVariant/shampoo",
      conditionerVariantId: "gid://shopify/ProductVariant/conditioner",
    };

    shopConfigFindUnique.mockResolvedValue(config);

    adminGraphqlMock.mockResolvedValue({
      json: async () => ({
        data: {
          subscriptionContract: {
            id: contractId,
            nextBillingDate: "2027-01-03T00:00:00.000Z",
            lines: {
              nodes: [
                {
                  sellingPlanId: config.rootRevival6WeekSellingPlanId,
                  variantId: "gid://shopify/ProductVariant/root-parent",
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
      nextBillingAt: new Date("2026-11-22T00:00:00.000Z"),
    });

    const response = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(response.status).toBe(200);

    expect(
      consumeCompleteReservedInventoryMock,
    ).toHaveBeenCalledWith({
      graphql: adminGraphqlMock,
      contractId,
      locationId: config.locationId,
      variantIds: [
        config.serumVariantId,
        config.shampooVariantId,
        config.conditionerVariantId,
      ],
      cycleIndex: 2,
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

    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(
      consumeCompleteReservedInventoryMock,
    ).not.toHaveBeenCalled();
    expect(
      markSerumReservedInventoryConsumedMock,
    ).toHaveBeenCalledWith({
      contractId,
      serumVariantId: config.serumVariantId,
      cycleIndex: 1,
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

  it("marks an already-released Serum reservation consumed exactly once after an uncertain billing retry succeeds", async () => {
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

    markSerumReservedInventoryConsumedMock
      .mockResolvedValueOnce({
        consumed: 1,
        skipped: false,
      })
      .mockResolvedValueOnce({
        consumed: 0,
        skipped: true,
      });

    const first = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    inventoryFindUnique.mockResolvedValue({
      id: "inventory-process-1",
      idempotencyKey: billingKey,
    });

    const duplicate = await action({
      request: new Request("https://example.com/webhook", {
        method: "POST",
      }),
    } as any);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(
      markSerumReservedInventoryConsumedMock,
    ).toHaveBeenCalledTimes(1);
    expect(deductInventoryMock).not.toHaveBeenCalled();
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

    expect(deductInventoryMock).not.toHaveBeenCalled();
    expect(
      consumeCompleteReservedInventoryMock,
    ).not.toHaveBeenCalled();
    expect(
      markSerumReservedInventoryConsumedMock,
    ).toHaveBeenCalledWith({
      contractId,
      serumVariantId: config.serumVariantId,
      cycleIndex: 2,
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
