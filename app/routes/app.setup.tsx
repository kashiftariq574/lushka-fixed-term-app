import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  createCompletePlan,
  createSerumPlan,
} from "../services/selling-plans.server";

const LOCATIONS_QUERY = `#graphql
  query SetupLocations {
    locations(first: 50) {
      nodes {
        id
        name
      }
    }
  }
`;

const VARIANT_PARENT_QUERY = `#graphql
  query VariantParentProduct($id: ID!) {
    node(id: $id) {
      ... on ProductVariant {
        id
        product {
          id
        }
      }
    }
  }
`;

type PickerValue = {
  id: string;
  label: string;
  productId?: string;
};

async function parentProductIdForVariant(
  admin: any,
  variantId: string,
): Promise<string> {
  const response = await admin.graphql(VARIANT_PARENT_QUERY, {
    variables: { id: variantId },
  });

  const json: any = await response.json();
  const productId = json.data?.node?.product?.id;

  if (!productId) {
    throw new Error(`Unable to find parent product for ${variantId}`);
  }

  return productId;
}

function required(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const config = await db.shopConfig.findUnique({
    where: { shop: session.shop },
  });

  const response = await admin.graphql(LOCATIONS_QUERY);
  const json: any = await response.json();

  return {
    config,
    locations: json.data?.locations?.nodes ?? [],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const completeParentVariantId = required(
      formData,
      "completeParentVariantId",
    );

    const serumVariantId = required(formData, "serumVariantId");
    const shampooVariantId = required(formData, "shampooVariantId");
    const conditionerVariantId = required(
      formData,
      "conditionerVariantId",
    );
    const maskVariantId = required(formData, "maskVariantId");
    const oilVariantId = required(formData, "oilVariantId");

    const massagerVariantId =
      String(formData.get("massagerVariantId") ?? "").trim() || null;

    const locationId = required(formData, "locationId");

    const existing = await db.shopConfig.findUnique({
      where: { shop: session.shop },
    });

    if (
      existing?.completeSellingPlanId &&
      existing.completeParentVariantId &&
      existing.completeParentVariantId !== completeParentVariantId
    ) {
      return {
        ok: false,
        error:
          "Complete Recovery product cannot be changed because its selling plan already exists.",
      };
    }

    if (
      existing?.serumSellingPlanId &&
      existing.serumVariantId &&
      existing.serumVariantId !== serumVariantId
    ) {
      return {
        ok: false,
        error:
          "Serum product cannot be changed because its selling plan already exists.",
      };
    }

    const completeParentProductId =
      await parentProductIdForVariant(
        admin,
        completeParentVariantId,
      );

    const serumParentProductId =
      await parentProductIdForVariant(admin, serumVariantId);

    let config = await db.shopConfig.upsert({
      where: {
        shop: session.shop,
      },

      update: {
        completeParentProductId,
        completeParentVariantId,

        serumVariantId,
        shampooVariantId,
        conditionerVariantId,
        maskVariantId,
        oilVariantId,
        massagerVariantId,

        locationId,
      },

      create: {
        shop: session.shop,

        completeParentProductId,
        completeParentVariantId,

        serumVariantId,
        shampooVariantId,
        conditionerVariantId,
        maskVariantId,
        oilVariantId,
        massagerVariantId,

        locationId,
      },
    });

    const graphqlClient = {
      request: async (
        query: string,
        opts?: { variables?: Record<string, unknown> },
      ) => {
        const response = await admin.graphql(query, {
          variables: opts?.variables ?? {},
        });

        return await response.json();
      },
    };

    if (!config.completeSellingPlanId) {
      const completePlan = await createCompletePlan(
        graphqlClient,
        completeParentProductId,
      );

      config = await db.shopConfig.update({
        where: {
          shop: session.shop,
        },
        data: {
          completeSellingPlanGroupId: completePlan.groupId,
          completeSellingPlanId: completePlan.planId,
        },
      });
    }

    if (!config.serumSellingPlanId) {
      const serumPlan = await createSerumPlan(
        graphqlClient,
        serumParentProductId,
      );

      config = await db.shopConfig.update({
        where: {
          shop: session.shop,
        },
        data: {
          serumSellingPlanGroupId: serumPlan.groupId,
          serumSellingPlanId: serumPlan.planId,
        },
      });
    }

    return {
      ok: true,
      message: "LUSHKA subscription configuration saved successfully.",
      config,
    };
  } catch (error) {
    console.error(error);

    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save subscription configuration.",
    };
  }
};

export default function SetupPage() {
  const { config, locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [complete, setComplete] = useState<PickerValue | null>(
    config?.completeParentVariantId
      ? {
          id: config.completeParentVariantId,
          label: config.completeParentVariantId,
          productId: config.completeParentProductId ?? undefined,
        }
      : null,
  );

  const [serum, setSerum] = useState<PickerValue | null>(
    config?.serumVariantId
      ? { id: config.serumVariantId, label: config.serumVariantId }
      : null,
  );

  const [shampoo, setShampoo] = useState<PickerValue | null>(
    config?.shampooVariantId
      ? { id: config.shampooVariantId, label: config.shampooVariantId }
      : null,
  );

  const [conditioner, setConditioner] =
    useState<PickerValue | null>(
      config?.conditionerVariantId
        ? {
            id: config.conditionerVariantId,
            label: config.conditionerVariantId,
          }
        : null,
    );

  const [mask, setMask] = useState<PickerValue | null>(
    config?.maskVariantId
      ? { id: config.maskVariantId, label: config.maskVariantId }
      : null,
  );

  const [oil, setOil] = useState<PickerValue | null>(
    config?.oilVariantId
      ? { id: config.oilVariantId, label: config.oilVariantId }
      : null,
  );

  const [massager, setMassager] = useState<PickerValue | null>(
    config?.massagerVariantId
      ? {
          id: config.massagerVariantId,
          label: config.massagerVariantId,
        }
      : null,
  );

  async function pickVariant(
    setter: (value: PickerValue) => void,
  ) {
    const shopify = (window as any).shopify;

    const selected = await shopify.resourcePicker({
      type: "variant",
      multiple: false,
      action: "select",
    });

    if (!selected?.length) return;

    const variant = selected[0];

    setter({
      id: variant.id,
      label:
        variant.displayName ||
        variant.title ||
        variant.id,
      productId: variant.product?.id,
    });
  }

  function VariantRow({
    title,
    value,
    setter,
    optional = false,
  }: {
    title: string;
    value: PickerValue | null;
    setter: (value: PickerValue) => void;
    optional?: boolean;
  }) {
    return (
      <div
        style={{
          padding: "14px 0",
          borderBottom: "1px solid #e1e3e5",
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <strong>{title}</strong>
          {optional ? " (optional)" : ""}
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => pickVariant(setter)}
          >
            {value ? "Change variant" : "Select variant"}
          </button>

          <span>
            {value ? value.label : "Not selected"}
          </span>
        </div>
      </div>
    );
  }

  const saving = navigation.state === "submitting";

  return (
    <s-page heading="LUSHKA Subscription Setup">
      <s-section heading="Products and variants">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <VariantRow
              title="Complete Haircare Recovery 90 parent variant"
              value={complete}
              setter={setComplete}
            />

            <VariantRow
              title="Multi-Peptide Hair Growth Serum"
              value={serum}
              setter={setSerum}
            />

            <VariantRow
              title="Shampoo"
              value={shampoo}
              setter={setShampoo}
            />

            <VariantRow
              title="Conditioner"
              value={conditioner}
              setter={setConditioner}
            />

            <VariantRow
              title="Hair Mask"
              value={mask}
              setter={setMask}
            />

            <VariantRow
              title="Hair Oil"
              value={oil}
              setter={setOil}
            />

            <VariantRow
              title="Scalp Massager"
              value={massager}
              setter={setMassager}
              optional
            />

            <input
              type="hidden"
              name="completeParentVariantId"
              value={complete?.id ?? ""}
            />

            <input
              type="hidden"
              name="serumVariantId"
              value={serum?.id ?? ""}
            />

            <input
              type="hidden"
              name="shampooVariantId"
              value={shampoo?.id ?? ""}
            />

            <input
              type="hidden"
              name="conditionerVariantId"
              value={conditioner?.id ?? ""}
            />

            <input
              type="hidden"
              name="maskVariantId"
              value={mask?.id ?? ""}
            />

            <input
              type="hidden"
              name="oilVariantId"
              value={oil?.id ?? ""}
            />

            <input
              type="hidden"
              name="massagerVariantId"
              value={massager?.id ?? ""}
            />

            <div style={{ marginTop: 24 }}>
              <label htmlFor="locationId">
                <strong>Fulfilment location</strong>
              </label>

              <div style={{ marginTop: 8 }}>
                <select
                  id="locationId"
                  name="locationId"
                  defaultValue={config?.locationId ?? ""}
                  required
                  style={{
                    minWidth: 320,
                    padding: 8,
                  }}
                >
                  <option value="">
                    Select Shopify location
                  </option>

                  {locations.map(
                    (location: { id: string; name: string }) => (
                      <option
                        key={location.id}
                        value={location.id}
                      >
                        {location.name}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <button
                type="submit"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : "Save configuration & create selling plans"}
              </button>
            </div>
          </Form>
        </s-box>
      </s-section>

      {actionData?.ok && (
        <s-section heading="Setup complete">
          <s-paragraph>
            {actionData.message}
          </s-paragraph>
        </s-section>
      )}

      {actionData && !actionData.ok && (
        <s-section heading="Setup error">
          <s-paragraph>
            {actionData.error}
          </s-paragraph>
        </s-section>
      )}

      <s-section slot="aside" heading="Selling plans">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Complete Recovery:{" "}
            {config?.completeSellingPlanId
              ? "Created"
              : "Not created"}
          </s-paragraph>

          <s-paragraph>
            Serum Ritual:{" "}
            {config?.serumSellingPlanId
              ? "Created"
              : "Not created"}
          </s-paragraph>

          <s-paragraph>
            Both programmes are fixed to 3 monthly payments.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}