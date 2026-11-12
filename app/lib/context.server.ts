import { createShopifyClient, requireShop, ShopifyFilesStore } from "@sv/core";
import { authenticate, unauthenticated } from "../shopify.server";

/** Everything an admin route needs: auth, our shop row and a Shopify client. */
export async function adminContext(request: Request) {
  const { admin, session, billing, redirect } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const client = createShopifyClient(session.shop, admin.graphql);
  return {
    admin,
    session,
    billing,
    redirect,
    shop,
    client,
    store: new ShopifyFilesStore(client),
  };
}

/** Offline client for a shop, outside a merchant request. */
export async function clientFor(shopDomain: string) {
  const { admin } = await unauthenticated.admin(shopDomain);
  return createShopifyClient(shopDomain, admin.graphql);
}

export function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}
