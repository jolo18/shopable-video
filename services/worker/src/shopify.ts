/**
 * Offline Admin API access for the worker. Uses the same Shopify app library
 * and session table as the app server, so expiring offline tokens refresh
 * the same way.
 */
import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { createShopifyClient, prisma, type ClientFor } from "@sv/core";

let app: ReturnType<typeof shopifyApp> | null = null;

function getApp() {
  app ??= shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.October26,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "https://localhost",
    sessionStorage: new PrismaSessionStorage(prisma),
    future: { expiringOfflineAccessTokens: true },
  });
  return app;
}

export const clientFor: ClientFor = async (shopDomain) => {
  const { admin } = await getApp().unauthenticated.admin(shopDomain);
  return createShopifyClient(shopDomain, admin.graphql);
};
