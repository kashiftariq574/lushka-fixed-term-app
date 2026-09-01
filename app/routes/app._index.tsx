import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <s-page heading="Lushka Fixed-Term Subscriptions">
      <s-section heading="Complete Haircare Recovery 90">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-heading>Subscription configuration</s-heading>
            <s-paragraph>Regular value: £108</s-paragraph>
            <s-paragraph>Subscription payment: £81</s-paragraph>
            <s-paragraph>Discount: 25%</s-paragraph>
            <s-paragraph>Billing cycle: Monthly</s-paragraph>
            <s-paragraph>Maximum payments: 3</s-paragraph>
            <s-paragraph>Cycle 4: Blocked</s-paragraph>
            <s-paragraph>
              Scalp Massager: Included on cycle 1 only
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Serum Ritual 90">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-heading>Subscription configuration</s-heading>
            <s-paragraph>Regular value: £35</s-paragraph>
            <s-paragraph>Subscription payment: £28</s-paragraph>
            <s-paragraph>Discount: 20%</s-paragraph>
            <s-paragraph>Billing cycle: Monthly</s-paragraph>
            <s-paragraph>Maximum payments: 3</s-paragraph>
            <s-paragraph>Cycle 4: Blocked</s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="System status">
        <s-stack direction="block" gap="base">
          <s-paragraph>Subscriptions API access: Granted</s-paragraph>
          <s-paragraph>Development store: Connected</s-paragraph>
          <s-paragraph>Fixed-term limit: 3 payments</s-paragraph>
          <s-paragraph>Cycle 4 protection: Enabled</s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Next implementation">
        <s-paragraph>
          Connect test products, create selling plans, create a subscription
          contract, and verify billing cycles 1, 2, 3 and the cycle 4 block.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
