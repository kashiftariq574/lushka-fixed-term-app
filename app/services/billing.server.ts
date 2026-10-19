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

export class BillingAttemptDefinitiveError extends Error {
  readonly kind = "definitive" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BillingAttemptDefinitiveError";
  }
}

export class BillingAttemptUncertainError extends Error {
  readonly kind = "uncertain" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BillingAttemptUncertainError";
  }
}

export function isBillingAttemptDefinitiveError(
  error: unknown,
): error is BillingAttemptDefinitiveError {
  return error instanceof BillingAttemptDefinitiveError;
}

export function isBillingAttemptUncertainError(
  error: unknown,
): error is BillingAttemptUncertainError {
  return error instanceof BillingAttemptUncertainError;
}

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

const BILLING_CYCLE = `#graphql
query BillingCycle(
  $contractId: ID!
  $index: Int!
) {
  subscriptionBillingCycle(
    billingCycleInput: {
      contractId: $contractId
      selector: { index: $index }
    }
  ) {
    billingAttemptExpectedDate
  }
}`;

async function getBillingCycleOriginTime(
  graphql: GraphqlClient,
  contractId: string,
  cycleIndex: number,
): Promise<string> {
  /*
   * Any failure here happens before subscriptionBillingAttemptCreate
   * is submitted, so it is a definitive-before-submit outcome.
   */
  let response: Response;

  try {
    response = await graphql(BILLING_CYCLE, {
      variables: {
        contractId,
        index: cycleIndex,
      },
    });
  } catch (error) {
    throw new BillingAttemptDefinitiveError(
      "Billing cycle lookup failed before billing mutation submit",
      { cause: error },
    );
  }

  let result: any;

  try {
    result = await response.json();
  } catch (error) {
    throw new BillingAttemptDefinitiveError(
      "Billing cycle lookup response could not be parsed before billing mutation submit",
      { cause: error },
    );
  }

  const graphqlErrors = result?.errors ?? [];

  if (graphqlErrors.length > 0) {
    throw new BillingAttemptDefinitiveError(
      `Billing cycle lookup failed: ${JSON.stringify(graphqlErrors)}`,
    );
  }

  const originTime =
    result?.data?.subscriptionBillingCycle
      ?.billingAttemptExpectedDate ??
    result?.subscriptionBillingCycle
      ?.billingAttemptExpectedDate;

  if (!originTime) {
    throw new BillingAttemptDefinitiveError(
      `Billing cycle ${cycleIndex} expected date was not returned`,
    );
  }

  return String(originTime);
}

export async function createBillingAttempt(
  graphql: GraphqlClient,
  contractId: string,
  cycleIndex: number,
  suppliedIdempotencyKey?: string,
) {
  assertBillableCycle(cycleIndex);

  const idempotencyKey =
    suppliedIdempotencyKey ??
    deterministicBillingKey(contractId, cycleIndex);

  const originTime = await getBillingCycleOriginTime(
    graphql,
    contractId,
    cycleIndex,
  );

  let response: Response;

  try {
    response = await graphql(BILL, {
      variables: {
        contractId,
        input: {
          billingCycleSelector: {
            index: cycleIndex,
          },
          idempotencyKey,
          originTime,
        },
      },
    });
  } catch (error) {
    throw new BillingAttemptUncertainError(
      "Billing mutation transport failed after submission may have occurred",
      { cause: error },
    );
  }

  let result: any;

  try {
    result = await response.json();
  } catch (error) {
    throw new BillingAttemptUncertainError(
      "Billing mutation response parsing failed after submission may have occurred",
      { cause: error },
    );
  }

  const payload =
    result?.data?.subscriptionBillingAttemptCreate ??
    result?.subscriptionBillingAttemptCreate;

  const userErrors = payload?.userErrors ?? [];

  if (userErrors.length) {
    throw new BillingAttemptDefinitiveError(
      `Billing attempt rejected: ${JSON.stringify(userErrors)}`,
    );
  }

  const topLevelErrors = result?.errors ?? [];

  if (topLevelErrors.length > 0) {
    /*
     * The mutation was already submitted. Top-level GraphQL errors with
     * or without a partial payload are not a proven rejection.
     */
    throw new BillingAttemptUncertainError(
      `Billing mutation returned ambiguous GraphQL errors: ${JSON.stringify(
        topLevelErrors,
      )}`,
    );
  }

  const attempt = payload?.subscriptionBillingAttempt;

  if (!attempt) {
    throw new BillingAttemptUncertainError(
      "Billing mutation returned no subscriptionBillingAttempt after submission",
    );
  }

  return {
    idempotencyKey,
    attempt,
  };
}
