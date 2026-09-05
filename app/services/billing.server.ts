import {
  assertBillableCycle,
  deterministicBillingKey,
} from "../domain/subscription-policy";

type GraphqlClient = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

const BILL = `#graphql
mutation BillingAttempt(
  $contractId: ID!
  $input: SubscriptionBillingAttemptInput!
) {
  subscriptionBillingAttemptCreate(
    subscriptionContractId: $contractId
    subscriptionBillingAttemptInput: $input
  ) {
    subscriptionBillingAttempt {
      id
      ready
      errorMessage
      nextActionUrl
      order {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

export async function createBillingAttempt(
  graphql: GraphqlClient,
  contractId: string,
  cycleIndex: number,
) {
  assertBillableCycle(cycleIndex);

  const idempotencyKey = deterministicBillingKey(contractId, cycleIndex);

  const response = await graphql(BILL, {
    variables: {
      contractId,
      input: {
        billingCycleSelector: {
          index: cycleIndex,
        },
        idempotencyKey,
        originTime: new Date().toISOString(),
      },
    },
  });

  const result = await response.json();

  const payload =
    result?.data?.subscriptionBillingAttemptCreate ??
    result?.subscriptionBillingAttemptCreate;

  const errors = payload?.userErrors ?? [];

  if (errors.length) {
    throw new Error(
      `Billing attempt rejected: ${JSON.stringify(errors)}`,
    );
  }

  return {
    idempotencyKey,
    attempt: payload?.subscriptionBillingAttempt,
  };
}
