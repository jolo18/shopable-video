/**
 * Publisher (plan, C4): copies published state from Postgres to Shopify's
 * app-owned metaobjects and metafields. Nothing on the Shopify side is edited
 * directly, so publishAll can always rebuild it.
 */
import type { Prisma } from "@prisma/client";
import {
  APP_NAMESPACE,
  COLLECTION_WIDGET_KEY,
  CONFIG_KEY,
  CONFIG_NAMESPACE,
  MAX_VIDEOS_PER_WIDGET,
  PRODUCT_VIDEOS_KEY,
  SV_VIDEO_TYPE,
  SV_WIDGET_TYPE,
  VIDEO_FIELDS,
  WIDGET_FIELDS,
  entitlementsFor,
  metaobjectHandleForVideo,
  normalizeRules,
  normalizeWidgetSettings,
  type StorefrontConfig,
  type WidgetType,
} from "@sv/shared";
import { prisma, type Db } from "./db";
import { assertNoUserErrors, type ShopifyClient } from "./shopify/client";
import { normalizeShopSettings } from "./settings";

export interface Publisher {
  publishVideo(videoId: string): Promise<string | null>;
  unpublishVideos(metaobjectIds: string[]): Promise<void>;
  publishWidget(widgetId: string): Promise<string | null>;
  unpublishWidget(metaobjectId: string): Promise<void>;
  publishProduct(productId: string): Promise<void>;
  publishCollection(collectionId: string): Promise<void>;
  publishConfig(): Promise<void>;
}

const UPSERT = `#graphql
  mutation svMetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }`;

const DELETE = `#graphql
  mutation svMetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors { field message code }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation svMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message code }
    }
  }`;

const METAFIELDS_DELETE = `#graphql
  mutation svMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }`;

const APP_INSTALLATION = `#graphql
  query svAppInstallation { currentAppInstallation { id } }`;

const WIDGET_DEFINITION = `#graphql
  query svWidgetDefinition { metaobjectDefinitionByType(type: "$app:sv_widget") { type } }`;

const STOREFRONT_TOKEN_CREATE = `#graphql
  mutation svStorefrontToken($input: StorefrontAccessTokenInput!) {
    storefrontAccessTokenCreate(input: $input) {
      storefrontAccessToken { accessToken }
      userErrors { field message }
    }
  }`;

export class ShopifyPublisher implements Publisher {
  private appInstallationId?: string;

  constructor(
    private readonly shop: { id: string; domain: string; plan: string; settings: unknown },
    private readonly client: ShopifyClient,
    private readonly db: Db = prisma,
    private readonly opts: { ingestUrl?: string } = {},
  ) {}

  private async upsert(type: string, handle: string, fields: Record<string, string | null>) {
    const data = await this.client.request(UPSERT, {
      handle: { type, handle },
      metaobject: {
        fields: Object.entries(fields).map(([key, value]) => ({ key, value: value ?? "" })),
        capabilities: { publishable: { status: "ACTIVE" } },
      },
    });
    assertNoUserErrors("metaobjectUpsert", data.metaobjectUpsert);
    return data.metaobjectUpsert.metaobject.id as string;
  }

  private async deleteMetaobject(id: string) {
    const data = await this.client.request(DELETE, { id });
    const errs = (data.metaobjectDelete?.userErrors ?? []).filter(
      (e: { code?: string }) => e.code !== "RECORD_NOT_FOUND" && e.code !== "NOT_FOUND",
    );
    assertNoUserErrors("metaobjectDelete", { userErrors: errs });
  }

  private async setMetafields(metafields: Array<Record<string, string>>) {
    for (let i = 0; i < metafields.length; i += 25) {
      const data = await this.client.request(METAFIELDS_SET, { metafields: metafields.slice(i, i + 25) });
      assertNoUserErrors("metafieldsSet", data.metafieldsSet);
    }
  }

  private async deleteMetafields(ids: Array<{ ownerId: string; namespace: string; key: string }>) {
    if (!ids.length) return;
    const data = await this.client.request(METAFIELDS_DELETE, { metafields: ids });
    assertNoUserErrors("metafieldsDelete", data.metafieldsDelete);
  }

  /** Upserts the sv_video metaobject for a ready video. */
  async publishVideo(videoId: string): Promise<string | null> {
    const v = await this.db.video.findFirst({
      where: { id: videoId, shopId: this.shop.id },
      include: { products: { orderBy: { position: "asc" } } },
    });
    if (!v) return null;
    if (v.status !== "ready" || !v.shopifyFileId) {
      // Not playable yet: make sure no stale copy stays on the storefront.
      if (v.metaobjectId) {
        await this.deleteMetaobject(v.metaobjectId);
        await this.db.video.update({ where: { id: v.id }, data: { metaobjectId: null } });
      }
      return null;
    }
    const products = entitlementsFor(this.shop.plan).multiTag ? v.products : v.products.slice(0, 1);
    const id = await this.upsert(SV_VIDEO_TYPE, metaobjectHandleForVideo(v.id), {
      [VIDEO_FIELDS.video]: v.shopifyFileId,
      [VIDEO_FIELDS.title]: v.title,
      [VIDEO_FIELDS.caption]: v.caption,
      [VIDEO_FIELDS.cover]: v.coverFileId,
      [VIDEO_FIELDS.products]: JSON.stringify(products.map((p) => p.productId)),
      [VIDEO_FIELDS.appId]: v.id,
    });
    if (id !== v.metaobjectId) {
      await this.db.video.update({ where: { id: v.id }, data: { metaobjectId: id } });
    }
    return id;
  }

  async unpublishVideos(metaobjectIds: string[]) {
    for (const id of metaobjectIds) await this.deleteMetaobject(id);
  }

  /** Upserts the sv_widget metaobject; videos must be published first. */
  async publishWidget(widgetId: string): Promise<string | null> {
    const w = await this.db.widget.findFirst({
      where: { id: widgetId, shopId: this.shop.id },
      include: {
        videos: { orderBy: { position: "asc" }, include: { video: true } },
      },
    });
    if (!w) return null;
    const refs: string[] = [];
    for (const wv of w.videos) {
      if (refs.length >= MAX_VIDEOS_PER_WIDGET) break;
      const ref = wv.video.metaobjectId ?? (await this.publishVideo(wv.videoId));
      if (ref) refs.push(ref);
    }
    const type = w.type as WidgetType;
    const id = await this.upsert(SV_WIDGET_TYPE, w.handle, {
      [WIDGET_FIELDS.name]: w.name,
      [WIDGET_FIELDS.type]: type,
      [WIDGET_FIELDS.videos]: JSON.stringify(refs),
      [WIDGET_FIELDS.settings]: JSON.stringify(normalizeWidgetSettings(w.settings, type)),
      [WIDGET_FIELDS.rules]: JSON.stringify(normalizeRules(w.rules)),
      [WIDGET_FIELDS.appId]: w.id,
    });
    await this.db.widget.update({
      where: { id: w.id },
      data: { metaobjectId: id, status: "published", publishedAt: new Date(), dirty: false },
    });
    return id;
  }

  async unpublishWidget(metaobjectId: string) {
    await this.deleteMetaobject(metaobjectId);
  }

  /**
   * Product metafield: ready videos tagged with this product, newest first,
   * capped for Liquid loops. Feeds the product page widget (feature 33).
   */
  async publishProduct(productId: string) {
    const links = await this.db.videoProduct.findMany({
      where: { productId, video: { shopId: this.shop.id, status: "ready" } },
      include: { video: true },
      orderBy: { video: { createdAt: "desc" } },
      take: MAX_VIDEOS_PER_WIDGET,
    });
    const multi = entitlementsFor(this.shop.plan).multiTag;
    const refs: string[] = [];
    for (const l of links) {
      // On plans without multi-tag only a video's first product counts.
      if (!multi && l.position !== 0) continue;
      const ref = l.video.metaobjectId ?? (await this.publishVideo(l.videoId));
      if (ref) refs.push(ref);
    }
    if (refs.length === 0) {
      await this.deleteMetafields([{ ownerId: productId, namespace: APP_NAMESPACE, key: PRODUCT_VIDEOS_KEY }]);
      return;
    }
    await this.setMetafields([
      {
        ownerId: productId,
        namespace: APP_NAMESPACE,
        key: PRODUCT_VIDEOS_KEY,
        type: `list.metaobject_reference<${SV_VIDEO_TYPE}>`,
        value: JSON.stringify(refs),
      },
    ]);
  }

  /** Collection metafield pointing at the widget assigned to it (feature 34). */
  async publishCollection(collectionId: string) {
    const assignment = await this.db.widget.findFirst({
      where: {
        shopId: this.shop.id,
        status: "published",
        metaobjectId: { not: null },
        rules: { path: ["assignedCollections"], array_contains: [collectionId] },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!assignment?.metaobjectId) {
      await this.deleteMetafields([{ ownerId: collectionId, namespace: APP_NAMESPACE, key: COLLECTION_WIDGET_KEY }]);
      return;
    }
    await this.setMetafields([
      {
        ownerId: collectionId,
        namespace: APP_NAMESPACE,
        key: COLLECTION_WIDGET_KEY,
        type: `metaobject_reference<${SV_WIDGET_TYPE}>`,
        value: assignment.metaobjectId,
      },
    ]);
  }

  /** App-data metafield with shop-wide storefront config. */
  async publishConfig() {
    if (!this.appInstallationId) {
      const data = await this.client.request(APP_INSTALLATION);
      this.appInstallationId = data.currentAppInstallation.id as string;
    }
    const shop = await this.db.shop.findUniqueOrThrow({ where: { id: this.shop.id } });
    const settings = normalizeShopSettings(shop.settings);
    const raw = (shop.settings ?? {}) as Record<string, unknown>;
    let storefrontToken = typeof raw.storefrontToken === "string" ? raw.storefrontToken : "";
    if (!storefrontToken) {
      const t = await this.client.request(STOREFRONT_TOKEN_CREATE, { input: { title: "Shoppable videos embed" } });
      assertNoUserErrors("storefrontAccessTokenCreate", t.storefrontAccessTokenCreate);
      storefrontToken = t.storefrontAccessTokenCreate.storefrontAccessToken.accessToken;
      await this.db.shop.update({ where: { id: shop.id }, data: { settings: { ...raw, storefrontToken } } });
    }
    const def = await this.client.request(WIDGET_DEFINITION);
    const popup = settings.popupWidgetId
      ? await this.db.widget.findFirst({
          where: { id: settings.popupWidgetId, shopId: shop.id, status: "published" },
        })
      : null;
    const config: StorefrontConfig = {
      branding: entitlementsFor(shop.plan).branding,
      ingestUrl: this.opts.ingestUrl ?? process.env.INGEST_URL ?? "",
      cartMode: settings.cartMode,
      customCss: settings.customCss,
      translations: settings.translations,
      popupWidget: popup?.handle ?? null,
      storefrontToken,
      widgetType: def.metaobjectDefinitionByType?.type ?? "",
    };
    await this.setMetafields([
      {
        ownerId: this.appInstallationId,
        namespace: CONFIG_NAMESPACE,
        key: CONFIG_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ]);
  }
}

/**
 * Rebuilds everything on the Shopify side from Postgres (shop.publish_all
 * job, after reinstall or a plan change).
 */
export async function publishAll(publisher: Publisher, shopId: string, db: Db = prisma) {
  const videos = await db.video.findMany({ where: { shopId, status: "ready" }, select: { id: true } });
  for (const v of videos) await publisher.publishVideo(v.id);
  const widgets = await db.widget.findMany({ where: { shopId, status: "published" }, select: { id: true, rules: true } });
  for (const w of widgets) await publisher.publishWidget(w.id);
  const products = await db.videoProduct.findMany({
    where: { video: { shopId } },
    distinct: ["productId"],
    select: { productId: true },
  });
  for (const p of products) await publisher.publishProduct(p.productId);
  const collections = new Set<string>();
  for (const w of widgets) for (const c of assignedCollections(w.rules)) collections.add(c);
  for (const c of collections) await publisher.publishCollection(c);
  await publisher.publishConfig();
}

export function assignedCollections(rules: Prisma.JsonValue | unknown): string[] {
  const r = rules as { assignedCollections?: unknown } | null;
  return Array.isArray(r?.assignedCollections)
    ? r!.assignedCollections.filter((c): c is string => typeof c === "string")
    : [];
}
