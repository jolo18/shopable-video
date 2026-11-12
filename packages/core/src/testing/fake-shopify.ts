/**
 * In-memory Shopify Admin GraphQL fake for tests and local demos. It answers
 * the operations this codebase sends (named sv*), by operation name.
 */
import { createShopifyClient, type AdminGraphqlFn, type ShopifyClient } from "../shopify/client";

export interface FakeFile {
  id: string;
  kind: "VIDEO" | "IMAGE";
  status: "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
  resourceUrl: string;
  alt: string;
}

export interface FakeMetaobject {
  id: string;
  type: string;
  handle: string;
  fields: Record<string, string>;
}

export interface FakeMetafield {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface FakeProduct {
  id: string;
  title: string;
  handle: string;
  status?: string;
  imageUrl?: string;
  price?: string;
  collections?: string[];
}

type Vars = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class FakeShopify {
  files = new Map<string, FakeFile>();
  metaobjects = new Map<string, FakeMetaobject>();
  metafields: FakeMetafield[] = [];
  products = new Map<string, FakeProduct>();
  appInstallationId = "gid://shopify/AppInstallation/1";
  /** Operation names received, in order */
  calls: string[] = [];
  /** Make the next N requests answer THROTTLED */
  throttleNext = 0;
  /** Override or add handlers per operation */
  handlers: Record<string, (v: Vars) => unknown> = {};
  activeSubscriptions: Array<{ id: string; name: string; status: string; test: boolean }> = [];
  private seq = 1;

  constructor(public readonly shop = "test-shop.myshopify.com") {}

  nextId(type: string) {
    return `gid://shopify/${type}/${this.seq++}`;
  }

  /** Marks every processing file READY (or FAILED). */
  processAll(status: "READY" | "FAILED" = "READY") {
    for (const f of this.files.values()) if (f.status !== "READY") f.status = status;
  }

  addProduct(p: Partial<FakeProduct> & { title: string }): FakeProduct {
    const id = p.id ?? this.nextId("Product");
    const prod: FakeProduct = {
      id,
      handle: p.handle ?? p.title.toLowerCase().replace(/\W+/g, "-"),
      status: "ACTIVE",
      price: "10.00",
      ...p,
    };
    this.products.set(id, prod);
    return prod;
  }

  metafield(ownerId: string, namespace: string, key: string) {
    return this.metafields.find((m) => m.ownerId === ownerId && m.namespace === namespace && m.key === key);
  }

  metaobjectByHandle(type: string, handle: string) {
    return [...this.metaobjects.values()].find((m) => m.type === type && m.handle === handle);
  }

  graphql: AdminGraphqlFn = async (query, options) => {
    const name = query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "anonymous";
    this.calls.push(name);
    if (this.throttleNext > 0) {
      this.throttleNext--;
      return json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    }
    const vars = options?.variables ?? {};
    const handler = this.handlers[name] ?? (this as unknown as Record<string, (v: Vars) => unknown>)[`op_${name}`];
    if (!handler) return json({ errors: [{ message: `FakeShopify: no handler for ${name}` }] });
    try {
      return json({ data: handler.call(this, vars) });
    } catch (err) {
      return json({ errors: [{ message: (err as Error).message }] });
    }
  };

  client(): ShopifyClient {
    return createShopifyClient(this.shop, this.graphql, { sleep: async () => {} });
  }

  // ---- Files

  op_svStagedUploads(v: Vars) {
    return {
      stagedUploadsCreate: {
        stagedTargets: v.input.map((i: Vars) => {
          const key = `${this.seq++}-${i.filename}`;
          return {
            url: "https://shopify-staged-uploads.storage.googleapis.com/",
            resourceUrl: `https://shopify-staged-uploads.storage.googleapis.com/tmp/${key}`,
            parameters: [{ name: "key", value: `tmp/${key}` }],
          };
        }),
        userErrors: [],
      },
    };
  }

  op_svFileCreate(v: Vars) {
    const files = v.files.map((f: Vars) => {
      const kind = f.contentType === "IMAGE" ? "IMAGE" : "VIDEO";
      const file: FakeFile = {
        id: this.nextId(kind === "IMAGE" ? "MediaImage" : "Video"),
        kind,
        status: "PROCESSING",
        resourceUrl: f.originalSource,
        alt: f.alt ?? "",
      };
      this.files.set(file.id, file);
      return { id: file.id, fileStatus: "UPLOADED" };
    });
    return { fileCreate: { files, userErrors: [] } };
  }

  op_svFile(v: Vars) {
    const f = this.files.get(v.id);
    if (!f) return { node: null };
    const n = f.id.split("/").pop();
    if (f.kind === "IMAGE") {
      return {
        node: {
          id: f.id,
          fileStatus: f.status,
          fileErrors: [],
          image: f.status === "READY" ? { url: `https://cdn.shopify.com/s/files/img-${n}.jpg`, width: 1080, height: 1920 } : null,
        },
      };
    }
    const ready = f.status === "READY";
    return {
      node: {
        id: f.id,
        fileStatus: f.status,
        fileErrors: f.status === "FAILED" ? [{ message: "Corrupt file" }] : [],
        duration: ready ? 15000 : null,
        preview: ready ? { image: { url: `https://cdn.shopify.com/s/files/preview-${n}.jpg`, width: 1080, height: 1920 } } : null,
        sources: ready
          ? [
              { url: `https://cdn.shopify.com/videos/c/vp/${n}/${n}.HD-1080p.mp4`, mimeType: "video/mp4", width: 1080, height: 1920 },
              { url: `https://cdn.shopify.com/videos/c/vp/${n}/${n}.SD-480p.mp4`, mimeType: "video/mp4", width: 480, height: 854 },
              { url: `https://cdn.shopify.com/videos/c/vp/${n}/${n}.m3u8`, mimeType: "application/x-mpegURL", width: 1080, height: 1920 },
            ]
          : [],
      },
    };
  }

  op_svFileDelete(v: Vars) {
    const deleted: string[] = [];
    const userErrors: Vars[] = [];
    for (const id of v.fileIds) {
      if (this.files.delete(id)) deleted.push(id);
      else userErrors.push({ field: ["fileIds"], message: "File does not exist", code: "FILE_DOES_NOT_EXIST" });
    }
    return { fileDelete: { deletedFileIds: deleted, userErrors } };
  }
  // ---- Metaobjects and metafields

  op_svMetaobjectUpsert(v: Vars) {
    const { type, handle } = v.handle;
    let m = this.metaobjectByHandle(type, handle);
    if (!m) {
      m = { id: this.nextId("Metaobject"), type, handle, fields: {} };
      this.metaobjects.set(m.id, m);
    }
    for (const f of v.metaobject.fields) m.fields[f.key] = f.value;
    return { metaobjectUpsert: { metaobject: { id: m.id, handle }, userErrors: [] } };
  }

  op_svMetaobjectDelete(v: Vars) {
    const existed = this.metaobjects.delete(v.id);
    return {
      metaobjectDelete: existed
        ? { deletedId: v.id, userErrors: [] }
        : { deletedId: null, userErrors: [{ field: ["id"], message: "Record not found", code: "RECORD_NOT_FOUND" }] },
    };
  }

  op_svMetafieldsSet(v: Vars) {
    const out = v.metafields.map((mf: FakeMetafield) => {
      this.metafields = this.metafields.filter(
        (m) => !(m.ownerId === mf.ownerId && m.namespace === mf.namespace && m.key === mf.key),
      );
      this.metafields.push({ ...mf });
      return { id: this.nextId("Metafield"), key: mf.key, namespace: mf.namespace };
    });
    return { metafieldsSet: { metafields: out, userErrors: [] } };
  }

  op_svMetafieldsDelete(v: Vars) {
    const deleted = v.metafields.map((id: Vars) => {
      const had = this.metafield(id.ownerId, id.namespace, id.key);
      this.metafields = this.metafields.filter((m) => m !== had);
      return had ? id : null;
    });
    return { metafieldsDelete: { deletedMetafields: deleted, userErrors: [] } };
  }

  op_svAppInstallation() {
    return { currentAppInstallation: { id: this.appInstallationId, activeSubscriptions: this.activeSubscriptions } };
  }

  op_svActiveSubscriptions() {
    return { currentAppInstallation: { activeSubscriptions: this.activeSubscriptions } };
  }

  op_svWidgetDefinition() {
    return { metaobjectDefinitionByType: { type: "app--1--sv_widget" } };
  }

  webPixel: { id: string; settings: string } | null = null;
  op_svWebPixel() {
    if (!this.webPixel) throw Object.assign(new Error("No web pixel was found for this app."), { fake: true });
    return { webPixel: this.webPixel };
  }
  op_svWebPixelCreate(v: Vars) {
    this.webPixel = { id: this.nextId("WebPixel"), settings: v.webPixel.settings };
    return { webPixelCreate: { webPixel: { id: this.webPixel.id }, userErrors: [] } };
  }
  op_svWebPixelUpdate(v: Vars) {
    this.webPixel = { id: v.id, settings: v.webPixel.settings };
    return { webPixelUpdate: { webPixel: { id: v.id }, userErrors: [] } };
  }

  storefrontTokens = 0;
  op_svStorefrontToken() {
    this.storefrontTokens++;
    return { storefrontAccessTokenCreate: { storefrontAccessToken: { accessToken: `sf-${this.storefrontTokens}` }, userErrors: [] } };
  }

  op_svProducts(v: Vars) {
    return {
      nodes: v.ids.map((id: string) => {
        const p = this.products.get(id);
        return p
          ? {
              id: p.id,
              title: p.title,
              handle: p.handle,
              status: p.status,
              featuredMedia: p.imageUrl ? { preview: { image: { url: p.imageUrl } } } : null,
              hasOnlyDefaultVariant: true,
              priceRangeV2: { minVariantPrice: { amount: p.price ?? "10.00" } },
              compareAtPriceRange: { maxVariantCompareAtPrice: null },
              variants: { nodes: [{ id: p.id.replace("Product", "ProductVariant") }] },
            }
          : null;
      }),
    };
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
