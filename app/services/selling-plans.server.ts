import { COMPLETE, SERUM } from "../domain/subscription-policy";

type GraphqlClient = { request: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<any> };

const MUTATION = `#graphql
mutation CreateSellingPlanGroup($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
  sellingPlanGroupCreate(input: $input, resources: $resources) {
    sellingPlanGroup {
      id
      name
      sellingPlans(first: 10) {
        nodes {
          id
          name
          billingPolicy {
            ... on SellingPlanRecurringBillingPolicy { interval intervalCount minCycles maxCycles }
          }
          deliveryPolicy {
            ... on SellingPlanRecurringDeliveryPolicy { interval intervalCount }
          }
        }
      }
    }
    userErrors { field message }
  }
}`;

function inputFor(name: string, discountPct: number) {
  return {
    name,
    merchantCode: `LUSHKA_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    options: ["Delivery every"],
    position: 1,
    sellingPlansToCreate: [{
      name,
      category: "SUBSCRIPTION",
      options: ["1 month"],
      position: 1,
      billingPolicy: { recurring: { interval: "MONTH", intervalCount: 1, minCycles: 3, maxCycles: 3 } },
      deliveryPolicy: { recurring: { interval: "MONTH", intervalCount: 1 } },
      pricingPolicies: [{ fixed: { adjustmentType: "PERCENTAGE", adjustmentValue: { percentage: discountPct } } }],
    }],
  };
}

export async function createCompletePlan(client: GraphqlClient, productId: string) {
  return createPlan(client, "Complete Haircare Recovery 90", COMPLETE.discountPct, productId);
}

export async function createSerumPlan(client: GraphqlClient, productId: string) {
  return createPlan(client, "Serum Ritual 90", SERUM.discountPct, productId);
}

async function createPlan(client: GraphqlClient, name: string, discountPct: number, productId: string) {
  const result = await client.request(MUTATION, {
    variables: { input: inputFor(name, discountPct), resources: { productIds: [productId] } },
  });
  const payload = result?.data?.sellingPlanGroupCreate ?? result?.sellingPlanGroupCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length) throw new Error(`Shopify selling plan error: ${JSON.stringify(errors)}`);
  const node = payload?.sellingPlanGroup;
  const plan = node?.sellingPlans?.nodes?.[0];
  if (!plan) throw new Error("Shopify did not return the created selling plan");
  if (plan.billingPolicy?.maxCycles !== 3 || plan.billingPolicy?.minCycles !== 3) {
    throw new Error("Created selling plan is not fixed to exactly 3 cycles");
  }
  return { groupId: node.id, planId: plan.id, raw: node };
}
