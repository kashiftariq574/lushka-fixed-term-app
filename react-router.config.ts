import type { Config } from "@react-router/dev/config";

export default {
  allowedActionOrigins: [
    "lushka-app-production.up.railway.app",
    "lushka-app-staging.up.railway.app",
    "admin.shopify.com",
    "b0z0gt-be.myshopify.com",
    "lushkacosmetic.myshopify.com",
  ],
} satisfies Config;
