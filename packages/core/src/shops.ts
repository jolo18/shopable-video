import { prisma, type Db } from "./db";
import { entitlementsFor, type Entitlements } from "@sv/shared";

export async function ensureShop(domain: string, db: Db = prisma) {
  return db.shop.upsert({
    where: { domain },
    create: { domain },
    update: { uninstalledAt: null },
  });
}

export async function getShopByDomain(domain: string, db: Db = prisma) {
  return db.shop.findUnique({ where: { domain } });
}

export async function requireShop(domain: string, db: Db = prisma) {
  const shop = await db.shop.findUnique({ where: { domain } });
  return shop ?? ensureShop(domain, db);
}

export function shopEntitlements(shop: { plan: string }): Entitlements {
  return entitlementsFor(shop.plan);
}

/**
 * app/uninstalled: drop tokens, keep data until shop/redact (48 hours later)
 * so a quick reinstall finds the library intact. Videos stay in the
 * merchant's own Shopify Files either way.
 */
export async function markUninstalled(domain: string, db: Db = prisma) {
  await db.session.deleteMany({ where: { shop: domain } });
  await db.shop.updateMany({
    where: { domain },
    data: { uninstalledAt: new Date(), plan: "free" },
  });
}

/** shop/redact: delete everything we hold for the shop. */
export async function redactShop(domain: string, db: Db = prisma) {
  const shop = await db.shop.findUnique({ where: { domain } });
  await db.session.deleteMany({ where: { shop: domain } });
  if (!shop) return;
  await db.$transaction([
    db.event.deleteMany({ where: { shopId: shop.id } }),
    db.statsDaily.deleteMany({ where: { shopId: shop.id } }),
    db.attributedOrder.deleteMany({ where: { shopId: shop.id } }),
    db.job.deleteMany({ where: { shopId: shop.id } }),
    // Cascades to videos, widgets, social accounts and import jobs.
    db.shop.delete({ where: { id: shop.id } }),
  ]);
}

/**
 * customers/redact: we store no names, emails or addresses. Orders named in
 * the request are removed from attribution and from raw checkout events.
 */
export async function redactCustomerOrders(
  domain: string,
  orderIds: Array<string | number>,
  db: Db = prisma,
) {
  const shop = await db.shop.findUnique({ where: { domain } });
  if (!shop || orderIds.length === 0) return;
  const ids = orderIds.map((o) => String(o).replace(/^.*\//, ""));
  const variants = ids.flatMap((id) => [id, `gid://shopify/Order/${id}`]);
  await db.attributedOrder.deleteMany({
    where: { shopId: shop.id, orderId: { in: variants } },
  });
  await db.$executeRaw`
    DELETE FROM events WHERE shop_id = ${shop.id}::uuid AND type = 'checkout_completed'
      AND payload->>'orderId' = ANY(${variants})`;
}
