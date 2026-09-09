import type { ReviewOrder } from "./review-order.server";
import type { ReviewFormSubmission } from "./review-form-submission.server";

function textField(
  key: string,
  name: string,
  value: string | null,
) {
  return {
    key,
    value,
    jsonValue: value,
    definition: {
      key,
      name,
      type: "single_line_text_field",
    },
  };
}

export function buildDay14ReviewSubmissionFromOrder({
  order,
  expectedHandle,
}: {
  order: ReviewOrder;
  expectedHandle: string;
}): ReviewFormSubmission {
  const bridge = order.day14ReviewBridge;

  if (!bridge.handle) {
    throw new Error(
      "Day-14 review bridge handle is missing from the exact order",
    );
  }

  if (bridge.handle !== expectedHandle) {
    throw new Error(
      "Day-14 review bridge handle does not match the READY signal",
    );
  }

  return {
    id: `order:${order.id}:day14:${expectedHandle}`,
    handle: expectedHandle,
    type: "lushka-order-metafield-review-bridge",
    fields: [
      textField(
        "email",
        "Email",
        bridge.email,
      ),
      textField(
        "order_number",
        "Order number",
        bridge.orderNumber,
      ),
      textField(
        "product",
        "Product",
        bridge.product,
      ),
      {
        ...textField(
          "review",
          "Review",
          bridge.review,
        ),
        definition: {
          key: "review",
          name: "Review",
          type: "multi_line_text_field",
        },
      },
    ],
  };
}
