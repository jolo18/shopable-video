/**
 * Tagging service (plan, C3; features 13, 14): video to product links.
 */
import { entitlementsFor } from "@sv/shared";
import { prisma, type Db } from "./db";

export const MAX_PRODUCTS_PER_VIDEO = 10;

export class EntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

/** Replaces a video's products, in order. Returns every product touched. */
export async function setVideoProducts(
  shop: { id: string; plan: string },
  videoId: string,
  productIds: string[],
  db: Db = prisma,
) {
  const ids = [...new Set(productIds)].filter((p) => PRODUCT_GID.test(p));
  if (ids.length > 1 && !entitlementsFor(shop.plan).multiTag) {
    throw new EntitlementError("Your plan tags one product per video. Upgrade to tag several.");
  }
  if (ids.length > MAX_PRODUCTS_PER_VIDEO) {
    throw new EntitlementError(`Tag at most ${MAX_PRODUCTS_PER_VIDEO} products per video.`);
  }
  const video = await db.video.findFirst({
    where: { id: videoId, shopId: shop.id },
    include: { products: true },
  });
  if (!video) throw new Error("Video not found");
  const before = video.products.map((p) => p.productId);
  await db.$transaction([
    db.videoProduct.deleteMany({ where: { videoId } }),
    db.videoProduct.createMany({
      data: ids.map((productId, position) => ({ videoId, productId, position })),
    }),
  ]);
  return { touched: [...new Set([...before, ...ids])] };
}

/** Product ids tagged on any video of the shop. */
export async function taggedProductIds(shopId: string, db: Db = prisma) {
  const rows = await db.videoProduct.findMany({
    where: { video: { shopId } },
    distinct: ["productId"],
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}
