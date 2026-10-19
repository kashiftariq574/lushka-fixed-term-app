import {
  COMPLETE,
  ROOT_REVIVAL,
  SERUM,
} from "../domain/subscription-policy";

type GraphqlClient = {
  request: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<any>;
};

const EXISTING_PLANS_QUERY = `#graphql
query ExistingSellingPlans($id: ID!) {
  product(id: $id) {
    sellingPlanGroups(first: 50) {
      nodes {
        id
        merchantCode
        sellingPlans(first: 10) {
          nodes {
            id
            name
            billingPolicy {
              ... on SellingPlanRecurringBillingPolicy {
                interval
                intervalCount
                minCycles
                maxCycles
              }
            }
            deliveryPolicy {
              ... on SellingPlanRecurringDeliveryPolicy {
                interval
                intervalCount
              }
            }
          }
        }
      }
    }
  }
}
`;

const MUTATION = `#graphql
mutation CreateSellingPlanGroup(
  $input: SellingPlanGroupInput!,
  $resources: SellingPlanGroupResourceInput
) {
  sellingPlanGroupCreate(
    input: $input,
    resources: $resources
  ) {
    sellingPlanGroup {
      id
      name
      sellingPlans(first: 10) {
        nodes {
          id
          name
          billingPolicy {
            ... on SellingPlanRecurringBillingPolicy {
              interval
              intervalCount
              minCycles
              maxCycles
            }
          }
          deliveryPolicy {
            ... on SellingPlanRecurringDeliveryPolicy {
              interval
              intervalCount
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

function merchantCodeFor(name: string) {
  return `LUSHKA_${name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;
}

function inputFor(name: string, discountPct: number) {
  return {
    name,
    merchantCode: merchantCodeFor(name),
    options: ["Delivery every"],
    position: 1,
    sellingPlansToCreate: [
      {
        name,
        category: "SUBSCRIPTION",
        options: ["1 month"],
        position: 1,
        billingPolicy: {
          recurring: {
            interval: "MONTH",
            intervalCount: 1,
            minCycles: 3,
            maxCycles: 3,
          },
        },
        deliveryPolicy: {
          recurring: {
            interval: "MONTH",
            intervalCount: 1,
          },
        },
        pricingPolicies: [
          {
            fixed: {
              adjustmentType: "PERCENTAGE",
              adjustmentValue: {
                percentage: discountPct,
              },
            },
          },
        ],
      },
    ],
  };
}

function rootRevivalInput() {
  return {
    name: "Root Revival Subscription Trio",
    merchantCode: merchantCodeFor(
      "Root Revival Subscription Trio",
    ),
    options: ["Delivery every"],
    position: 1,

    sellingPlansToCreate:
      ROOT_REVIVAL.allowedIntervalCounts.map(
        (weeks, index) => ({
          name: `Every ${weeks} weeks`,
          category: "SUBSCRIPTION",
          options: [`${weeks} weeks`],
          position: index + 1,

          billingPolicy: {
            recurring: {
              interval: "WEEK",
              intervalCount: weeks,
              minCycles: ROOT_REVIVAL.maxCycles,
              maxCycles: ROOT_REVIVAL.maxCycles,
            },
          },

          deliveryPolicy: {
            recurring: {
              interval: "WEEK",
              intervalCount: weeks,
            },
          },

          pricingPolicies: [
            {
              fixed: {
                adjustmentType: "PRICE",
                adjustmentValue: {
                  fixedValue:
                    ROOT_REVIVAL.chargeMinor / 100,
                },
              },
            },
          ],
        }),
      ),
  };
}

export async function createCompletePlan(
  client: GraphqlClient,
  productId: string,
) {
  return createPlan(
    client,
    "Complete Haircare Recovery 90",
    COMPLETE.discountPct,
    productId,
  );
}

export async function createSerumPlan(
  client: GraphqlClient,
  productId: string,
) {
  return createPlan(
    client,
    "Serum Ritual 90",
    SERUM.discountPct,
    productId,
  );
}

export async function createRootRevivalPlans(
  client: GraphqlClient,
  productId: string,
) {
  const name = "Root Revival Subscription Trio";

  const existingResult = await client.request(
    EXISTING_PLANS_QUERY,
    {
      variables: { id: productId },
    },
  );

  const product =
    existingResult?.data?.product ??
    existingResult?.product;

  const matchingGroups =
    product?.sellingPlanGroups?.nodes?.filter(
      (group: any) =>
        group?.merchantCode === merchantCodeFor(name),
    ) ?? [];

  if (matchingGroups.length > 1) {
    throw new Error(
      `Multiple LUSHKA selling plan groups already exist for ${name}`,
    );
  }

  if (matchingGroups.length === 1) {
    const group = matchingGroups[0];

    const ids = validateAndMapRootRevivalPlans(
      group?.sellingPlans?.nodes ?? [],
    );

    return {
      groupId: group.id,
      ...ids,
      raw: group,
    };
  }

  const result = await client.request(MUTATION, {
    variables: {
      input: rootRevivalInput(),
      resources: {
        productIds: [productId],
      },
    },
  });

  const payload =
    result?.data?.sellingPlanGroupCreate ??
    result?.sellingPlanGroupCreate;

  const errors = payload?.userErrors ?? [];

  if (errors.length) {
    throw new Error(
      `Shopify Root Revival selling plan error: ${JSON.stringify(errors)}`,
    );
  }

  const node = payload?.sellingPlanGroup;

  if (!node?.id) {
    throw new Error(
      "Shopify did not return the Root Revival selling plan group",
    );
  }

  const ids = validateAndMapRootRevivalPlans(
    node?.sellingPlans?.nodes ?? [],
  );

  return {
    groupId: node.id,
    ...ids,
    raw: node,
  };
}

function validateAndMapRootRevivalPlans(plans: any[]) {
  if (plans.length !== 3) {
    throw new Error(
      "Root Revival must contain exactly 3 selling plans",
    );
  }

  const result: Record<string, string> = {};

  for (const weeks of ROOT_REVIVAL.allowedIntervalCounts) {
    const plan = plans.find(
      (candidate: any) =>
        candidate?.billingPolicy?.interval === "WEEK" &&
        Number(
          candidate?.billingPolicy?.intervalCount,
        ) === weeks,
    );

    if (!plan?.id) {
      throw new Error(
        `Root Revival ${weeks}-week selling plan is missing`,
      );
    }

    if (
      Number(plan.billingPolicy?.minCycles) !==
        ROOT_REVIVAL.maxCycles ||
      Number(plan.billingPolicy?.maxCycles) !==
        ROOT_REVIVAL.maxCycles
    ) {
      throw new Error(
        `Root Revival ${weeks}-week plan is not fixed to exactly ${ROOT_REVIVAL.maxCycles} cycles`,
      );
    }

    if (
      plan.deliveryPolicy?.interval !== "WEEK" ||
      Number(
        plan.deliveryPolicy?.intervalCount,
      ) !== weeks
    ) {
      throw new Error(
        `Root Revival ${weeks}-week delivery interval is invalid`,
      );
    }

    result[`plan${weeks}WeekId`] = plan.id;
  }

  return {
    plan4WeekId: result.plan4WeekId,
    plan6WeekId: result.plan6WeekId,
    plan8WeekId: result.plan8WeekId,
  };
}

async function createPlan(
  client: GraphqlClient,
  name: string,
  discountPct: number,
  productId: string,
) {
  const existingResult = await client.request(
    EXISTING_PLANS_QUERY,
    {
      variables: { id: productId },
    },
  );

  const product =
    existingResult?.data?.product ??
    existingResult?.product;

  const matchingGroups =
    product?.sellingPlanGroups?.nodes?.filter(
      (group: any) =>
        group?.merchantCode === merchantCodeFor(name),
    ) ?? [];

  if (matchingGroups.length > 1) {
    throw new Error(
      `Multiple LUSHKA selling plan groups already exist for ${name}`,
    );
  }

  if (matchingGroups.length === 1) {
    const group = matchingGroups[0];
    const plan = group?.sellingPlans?.nodes?.[0];

    if (
      !plan ||
      plan.billingPolicy?.interval !== "MONTH" ||
      plan.billingPolicy?.intervalCount !== 1 ||
      plan.billingPolicy?.minCycles !== 3 ||
      plan.billingPolicy?.maxCycles !== 3
    ) {
      throw new Error(
        `Existing selling plan for ${name} is not fixed to exactly 3 monthly cycles`,
      );
    }

    return {
      groupId: group.id,
      planId: plan.id,
      raw: group,
    };
  }

  const result = await client.request(MUTATION, {
    variables: {
      input: inputFor(name, discountPct),
      resources: {
        productIds: [productId],
      },
    },
  });

  const payload =
    result?.data?.sellingPlanGroupCreate ??
    result?.sellingPlanGroupCreate;

  const errors = payload?.userErrors ?? [];

  if (errors.length) {
    throw new Error(
      `Shopify selling plan error: ${JSON.stringify(errors)}`,
    );
  }

  const node = payload?.sellingPlanGroup;
  const plan = node?.sellingPlans?.nodes?.[0];

  if (!plan) {
    throw new Error(
      "Shopify did not return the created selling plan",
    );
  }

  if (
    plan.billingPolicy?.maxCycles !== 3 ||
    plan.billingPolicy?.minCycles !== 3
  ) {
    throw new Error(
      "Created selling plan is not fixed to exactly 3 cycles",
    );
  }

  return {
    groupId: node.id,
    planId: plan.id,
    raw: node,
  };
}
