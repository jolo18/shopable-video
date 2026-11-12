import type { ShopifyClient } from "./shopify/client";

/** Gives an Admin API client for a shop (offline token). */
export type ClientFor = (shopDomain: string) => Promise<ShopifyClient>;
