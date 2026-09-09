import type { ReviewOrder } from "./review-order.server";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed || null;
}

function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function uniquePush(
  target: string[],
  seen: Set<string>,
  value: string | null,
) {
  if (!value) {
    return;
  }

  const key = normalized(value);

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(value);
}

export function reviewOrderEmailProductLabels(
  order: ReviewOrder,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  /*
   * Shopify bundles can expose several component line items sharing
   * the same lineItemGroup. Show the bundle parent once and then its
   * distinct components.
   */
  const groups = new Map<
    string,
    {
      title: string;
      components: string[];
    }
  >();

  for (const lineItem of order.lineItems) {
    const group = lineItem.lineItemGroup;

    if (group) {
      const groupKey =
        group.id || group.title;

      let entry = groups.get(groupKey);

      if (!entry) {
        entry = {
          title:
            clean(group.title) ||
            "Bundle",
          components: [],
        };

        groups.set(groupKey, entry);
      }

      const component =
        clean(lineItem.product?.title) ||
        clean(lineItem.name);

      if (
        component &&
        !entry.components.some(
          (existing) =>
            normalized(existing) ===
            normalized(component),
        )
      ) {
        entry.components.push(component);
      }

      continue;
    }

    const standalone =
      clean(lineItem.product?.title) ||
      clean(lineItem.name);

    uniquePush(
      result,
      seen,
      standalone,
    );
  }

  for (const group of groups.values()) {
    uniquePush(
      result,
      seen,
      group.title,
    );

    for (const component of group.components) {
      uniquePush(
        result,
        seen,
        `↳ ${component}`,
      );
    }
  }

  return result;
}

export function reviewStorefrontUrl(
  shop: string,
): string {
  const configuredStorefrontUrl =
    process.env.SHOP_STOREFRONT_URL?.trim();

  if (configuredStorefrontUrl) {
    let parsed: URL;

    try {
      parsed = new URL(
        configuredStorefrontUrl,
      );
    } catch {
      throw new Error(
        "SHOP_STOREFRONT_URL must be a valid http(s) URL",
      );
    }

    if (
      parsed.protocol !== "https:" &&
      parsed.protocol !== "http:"
    ) {
      throw new Error(
        "SHOP_STOREFRONT_URL must use http or https",
      );
    }

    /*
     * Review CTAs always start from the storefront root, so return
     * the canonical origin and avoid duplicate/trailing slashes.
     */
    return parsed.origin;
  }

  const normalizedShop =
    shop.trim().toLowerCase();

  if (!normalizedShop) {
    throw new Error(
      "Shop domain is required for review email links",
    );
  }

  /*
   * Safe fallback when a branded storefront URL has not yet been
   * configured. Shopify's permanent myshopify.com domain remains
   * available for the store.
   */
  return `https://${normalizedShop}`;
}
