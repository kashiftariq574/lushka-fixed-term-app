import { describe, it, expect } from "vitest";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

describe("manual Root lifecycle name context check", () => {
  it("reads latest Root contract delivery and customer names", async () => {
    const event = await prisma.emailEvent.findFirst({
      where: {
        emailType: "ROOT_WELCOME",
      },
      orderBy: {
        dueAt: "desc",
      },
      select: {
        shop: true,
        contractId: true,
        recipientEmail: true,
        dueAt: true,
      },
    });

    expect(event).toBeTruthy();

    const { admin } = await unauthenticated.admin(event!.shop);

    const response = await admin.graphql(`#graphql
      query RootNameContext($id: ID!) {
        subscriptionContract(id: $id) {
          customer {
            firstName
          }
          deliveryMethod {
            __typename
            ... on SubscriptionDeliveryMethodShipping {
              address {
                firstName
              }
            }
            ... on SubscriptionDeliveryMethodLocalDelivery {
              address {
                firstName
              }
            }
          }
        }
      }
    `, {
      variables: {
        id: event!.contractId,
      },
    });

    const json: any = await response.json();

    if (json.errors?.length) {
      console.log("GRAPHQL_ERRORS", JSON.stringify(json.errors, null, 2));
      throw new Error("GraphQL query failed");
    }

    const contract = json.data?.subscriptionContract;

    console.log("CONTRACT_ID:", event!.contractId);
    console.log("DELIVERY_TYPE:", contract?.deliveryMethod?.__typename ?? null);
    console.log("DELIVERY_FIRST_NAME:", contract?.deliveryMethod?.address?.firstName ?? null);
    console.log("CUSTOMER_FIRST_NAME:", contract?.customer?.firstName ?? null);
  }, 30000);
});
