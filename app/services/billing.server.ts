import { assertBillableCycle, deterministicBillingKey } from "../domain/subscription-policy";

type GraphqlClient = { request: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<any> };

const BILL = `#graphql
mutation BillingAttempt($contractId: ID!, $input: SubscriptionBillingAttemptInput!) {
  subscriptionBillingAttemptCreate(subscriptionContractId: $contractId, subscriptionBillingAttemptInput: $input) {
    subscriptionBillingAttempt { id ready errorMessage nextActionUrl order { id } }
    userErrors { field message }
  }
}`;

export async function createBillingAttempt(client: GraphqlClient, contractId: string, cycleIndex: number) {
  assertBillableCycle(cycleIndex); // hard stop before any Shopify API call
  const idempotencyKey = deterministicBillingKey(contractId, cycleIndex);
  const result = await client.request(BILL, {
    variables: {
      contractId,
      input: {
        billingCycleSelector: { index: cycleIndex },
        idempotencyKey,
        originTime: new Date().toISOString(),
      },
    },
  });
  const payload = result?.data?.subscriptionBillingAttemptCreate ?? result?.subscriptionBillingAttemptCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length) throw new Error(`Billing attempt rejected: ${JSON.stringify(errors)}`);
  return { idempotencyKey, attempt: payload?.subscriptionBillingAttempt };
}
