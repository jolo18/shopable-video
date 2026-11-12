/**
 * What to republish after each kind of change. Shared by the app server and
 * the worker so both keep the storefront copy in step with Postgres.
 */
import { prisma, type Db } from "./db";
import { assignedCollections, type Publisher } from "./publisher";
import { publishedWidgetsWith } from "./widgets";

export async function onVideoReady(pub: Publisher, shopId: string, videoId: string, db: Db = prisma) {
  await pub.publishVideo(videoId);
  const products = await db.videoProduct.findMany({ where: { videoId }, select: { productId: true } });
  for (const p of products) await pub.publishProduct(p.productId);
  for (const w of await publishedWidgetsWith(shopId, [videoId], db)) await pub.publishWidget(w.id);
}

/** Title, caption or cover changed. The metaobject id is stable, so widgets need nothing. */
export async function onVideoEdited(pub: Publisher, videoId: string) {
  await pub.publishVideo(videoId);
}

export async function onVideoProductsChanged(pub: Publisher, videoId: string, touched: string[]) {
  await pub.publishVideo(videoId);
  for (const p of touched) await pub.publishProduct(p);
}

export async function onVideosDeleted(
  pub: Publisher,
  shopId: string,
  result: { metaobjectIds: string[]; productIds: string[]; widgetIds: string[] },
  db: Db = prisma,
) {
  // Republish containers first so nothing points at a deleted metaobject.
  const widgets = await db.widget.findMany({
    where: { shopId, id: { in: result.widgetIds }, status: "published" },
    select: { id: true },
  });
  for (const w of widgets) await pub.publishWidget(w.id);
  for (const p of result.productIds) await pub.publishProduct(p);
  await pub.unpublishVideos(result.metaobjectIds);
}

export async function publishWidgetAndPlacements(
  pub: Publisher,
  shopId: string,
  widgetId: string,
  previousCollections: string[] = [],
  db: Db = prisma,
) {
  await pub.publishWidget(widgetId);
  const w = await db.widget.findFirst({ where: { id: widgetId, shopId } });
  const now = assignedCollections(w?.rules);
  for (const c of new Set([...previousCollections, ...now])) await pub.publishCollection(c);
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  if ((shop.settings as { popupWidgetId?: string })?.popupWidgetId === widgetId) await pub.publishConfig();
}

export async function onWidgetDeleted(
  pub: Publisher,
  shopId: string,
  widget: { id: string; metaobjectId: string | null; rules: unknown },
  db: Db = prisma,
) {
  for (const c of assignedCollections(widget.rules)) await pub.publishCollection(c);
  if (widget.metaobjectId) await pub.unpublishWidget(widget.metaobjectId);
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const settings = (shop.settings ?? {}) as Record<string, unknown>;
  if (settings.popupWidgetId === widget.id) {
    await db.shop.update({ where: { id: shopId }, data: { settings: { ...settings, popupWidgetId: null } } });
    await pub.publishConfig();
  }
}
