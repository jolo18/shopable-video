/**
 * Plans through Shopify billing (feature 71). The shop's plan follows its
 * active app subscription; a change republishes everything so the badge,
 * multi-tag and limits apply on the storefront too.
 */
import { planByName, type PlanKey } from "@sv/shared";
import { prisma, type Db } from "./db";
import { enqueue } from "./jobs/queue";
import type { ShopifyClient } from "./shopify/client";

export interface Subscription {
  id?: string;
  name: string;
  status: string;
}

/** The plan an active subscription gives, or free. */
export function planFromSubscriptions(subs: Subscription[]): PlanKey {
  const active = subs.filter((s) => s.status === "ACTIVE");
  for (const s of active) {
    const plan = planByName(s.name);
    if (plan) return plan.key;
  }
  return "free";
}

export async function setShopPlan(shopId: string, plan: PlanKey, db: Db = prisma) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (shop.plan === plan) return false;
  await db.shop.update({ where: { id: shopId }, data: { plan } });
  await enqueue("shop.publish_all", {}, { shopId, dedupeKey: `publish_all:${shopId}` }, db);
  return true;
}

const ACTIVE_SUBSCRIPTIONS = `#graphql
  query svActiveSubscriptions { currentAppInstallation { activeSubscriptions { id name status } } }`;

/** Reads active subscriptions from Shopify and updates our plan. */
export async function syncPlan(shopId: string, client: ShopifyClient, db: Db = prisma): Promise<PlanKey> {
  const data = await client.request(ACTIVE_SUBSCRIPTIONS);
  const plan = planFromSubscriptions(data.currentAppInstallation?.activeSubscriptions ?? []);
  await setShopPlan(shopId, plan, db);
  return plan;
}

/** app_subscriptions/update webhook payload. */
export async function applySubscriptionWebhook(
  domain: string,
  payload: { app_subscription?: { name?: string; status?: string } },
  db: Db = prisma,
) {
  const shop = await db.shop.findUnique({ where: { domain } });
  const sub = payload.app_subscription;
  if (!shop || !sub?.name || !sub.status) return;
  const plan = planByName(sub.name);
  if (sub.status.toUpperCase() === "ACTIVE" && plan) {
    await setShopPlan(shop.id, plan.key, db);
  } else if (plan && plan.key === shop.plan) {
    // The current plan was cancelled, declined, frozen or expired.
    await setShopPlan(shop.id, "free", db);
  }
}
