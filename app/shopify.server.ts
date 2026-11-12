import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PAID_PLAN_KEYS, PLANS } from "@sv/shared";
import { enqueue, ensureShop } from "@sv/core";
import prisma from "./db.server";

// One billing entry per paid plan, keyed by the plan name (plan decision 5).
const billing = Object.fromEntries(
  PAID_PLAN_KEYS.map((key) => [
    PLANS[key].name,
    {
      trialDays: PLANS[key].trialDays,
      lineItems: [
        {
          amount: PLANS[key].price,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days as const,
        },
      ],
    },
  ]),
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      const shop = await ensureShop(session.shop);
      // Storefront config, web pixel and a rebuild of anything published
      // before a reinstall run in the worker.
      await enqueue("shop.publish_all", {}, { shopId: shop.id, dedupeKey: `publish_all:${shop.id}` });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
