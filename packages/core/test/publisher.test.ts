import { beforeEach, describe, expect, it } from "vitest";
import { FakeShopify } from "../src/testing";
import { ShopifyPublisher, publishAll } from "../src/publisher";
import { onVideoReady, onVideosDeleted, publishWidgetAndPlacements, onVideoProductsChanged } from "../src/publishing";
import { createWidget, setWidgetVideos, updateWidget } from "../src/widgets";
import { EntitlementError, setVideoProducts } from "../src/tagging";
import { deleteVideos } from "../src/videos/library";
import { ShopifyFilesStore } from "../src/videos/store";
import { makeShop, prisma, resetDb } from "../../../test/db";

const P1 = "gid://shopify/Product/101";
const P2 = "gid://shopify/Product/102";
const C1 = "gid://shopify/Collection/7";

async function readyVideo(shopId: string, title: string, fileId: string) {
  return prisma.video.create({ data: { shopId, title, status: "ready", shopifyFileId: fileId } });
}

describe("publisher", () => {
  let fake: FakeShopify;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeShopify();
  });

  async function setup(plan = "growth") {
    const shop = await makeShop(fake.shop, plan);
    const pub = new ShopifyPublisher(shop, fake.client(), prisma, { ingestUrl: "https://ingest.example" });
    return { shop, pub };
  }

  it("publishes a widget with everything a theme needs", async () => {
    const { shop, pub } = await setup();
    const a = await readyVideo(shop.id, "A", "gid://shopify/Video/1");
    const b = await readyVideo(shop.id, "B", "gid://shopify/Video/2");
    const pending = await prisma.video.create({ data: { shopId: shop.id, title: "C", status: "processing" } });
    await setVideoProducts(shop, a.id, [P1, P2]);

    const w = await createWidget(shop.id, { name: "Home carousel", type: "carousel" });
    await setWidgetVideos(shop.id, w.id, [b.id, a.id, pending.id]);
    await updateWidget(shop.id, w.id, {
      settings: { heading: "Shop the look", style: { cardRadius: 20 } },
      rules: { pageTypes: ["index"] },
      assignedCollections: [C1],
    });
    await publishWidgetAndPlacements(pub, shop.id, w.id);

    const mo = fake.metaobjectByHandle("$app:sv_widget", "home-carousel")!;
    expect(mo.fields.type).toBe("carousel");
    const refs = JSON.parse(mo.fields.videos);
    expect(refs).toHaveLength(2); // processing video left out
    const first = fake.metaobjects.get(refs[0])!;
    expect(first.fields.title).toBe("B");
    const va = fake.metaobjects.get(refs[1])!;
    expect(JSON.parse(va.fields.products)).toEqual([P1, P2]);
    expect(va.fields.video).toBe("gid://shopify/Video/1");
    expect(va.fields.app_id).toBe(a.id);
    expect(JSON.parse(mo.fields.settings).heading).toBe("Shop the look");
    expect(JSON.parse(mo.fields.rules).pageTypes).toEqual(["index"]);
    expect(fake.metafield(C1, "$app", "widget")?.value).toBe(mo.id);

    const stored = await prisma.widget.findUniqueOrThrow({ where: { id: w.id } });
    expect(stored.status).toBe("published");
    expect(stored.dirty).toBe(false);
  });

  it("keeps product metafields in step with tags", async () => {
    const { shop, pub } = await setup();
    const a = await readyVideo(shop.id, "A", "gid://shopify/Video/1");
    const t = await setVideoProducts(shop, a.id, [P1]);
    await onVideoProductsChanged(pub, a.id, t.touched);
    const mf = fake.metafield(P1, "$app", "videos")!;
    expect(mf.type).toBe("list.metaobject_reference<$app:sv_video>");
    expect(JSON.parse(mf.value)).toHaveLength(1);

    const t2 = await setVideoProducts(shop, a.id, [P2]);
    await onVideoProductsChanged(pub, a.id, t2.touched);
    expect(fake.metafield(P1, "$app", "videos")).toBeUndefined();
    expect(fake.metafield(P2, "$app", "videos")).toBeDefined();
  });

  it("enforces one product per video on the free plan", async () => {
    const { shop } = await setup("free");
    const a = await readyVideo(shop.id, "A", "gid://shopify/Video/1");
    await expect(setVideoProducts(shop, a.id, [P1, P2])).rejects.toBeInstanceOf(EntitlementError);
  });

  it("publishes a video once it becomes ready, into widgets that hold it", async () => {
    const { shop, pub } = await setup();
    const v = await prisma.video.create({ data: { shopId: shop.id, title: "late", status: "processing" } });
    const w = await createWidget(shop.id, { name: "W", type: "grid" });
    await setWidgetVideos(shop.id, w.id, [v.id]);
    await publishWidgetAndPlacements(pub, shop.id, w.id);
    expect(JSON.parse(fake.metaobjectByHandle("$app:sv_widget", "w")!.fields.videos)).toHaveLength(0);

    await prisma.video.update({ where: { id: v.id }, data: { status: "ready", shopifyFileId: "gid://shopify/Video/9" } });
    await onVideoReady(pub, shop.id, v.id);
    expect(JSON.parse(fake.metaobjectByHandle("$app:sv_widget", "w")!.fields.videos)).toHaveLength(1);
  });

  it("removes deleted videos everywhere", async () => {
    const { shop, pub } = await setup();
    const a = await readyVideo(shop.id, "A", "gid://shopify/Video/1");
    fake.files.set("gid://shopify/Video/1", { id: "gid://shopify/Video/1", kind: "VIDEO", status: "READY", resourceUrl: "", alt: "" });
    await setVideoProducts(shop, a.id, [P1]);
    const w = await createWidget(shop.id, { name: "W", type: "grid" });
    await setWidgetVideos(shop.id, w.id, [a.id]);
    await publishWidgetAndPlacements(pub, shop.id, w.id);
    await pub.publishProduct(P1);

    const res = await deleteVideos(shop.id, [a.id], new ShopifyFilesStore(fake.client()));
    await onVideosDeleted(pub, shop.id, res);
    expect(fake.files.size).toBe(0);
    expect(fake.metaobjectByHandle("$app:sv_video", `sv-video-${a.id}`)).toBeUndefined();
    expect(fake.metafield(P1, "$app", "videos")).toBeUndefined();
    expect(JSON.parse(fake.metaobjectByHandle("$app:sv_widget", "w")!.fields.videos)).toEqual([]);
  });

  it("publishes the storefront config and rebuilds everything", async () => {
    const { shop, pub } = await setup("free");
    await prisma.shop.update({ where: { id: shop.id }, data: { settings: { customCss: ".x{color:red}</style><script>", cartMode: "cart_page" } } });
    const a = await readyVideo(shop.id, "A", "gid://shopify/Video/1");
    await setVideoProducts(shop, a.id, [P1]);
    await publishAll(pub, shop.id);
    const cfg = JSON.parse(fake.metafield(fake.appInstallationId, "sv", "config")!.value);
    expect(cfg).toMatchObject({ branding: true, cartMode: "cart_page", ingestUrl: "https://ingest.example" });
    expect(cfg.customCss).not.toMatch(/<\/style|<script/i);
    expect(cfg).toMatchObject({ storefrontToken: "sf-1", widgetType: "app--1--sv_widget" });
    await pub.publishConfig();
    expect(fake.storefrontTokens).toBe(1); // token is reused
    expect(fake.metafield(P1, "$app", "videos")).toBeDefined();
  });

  it("survives Shopify throttling", async () => {
    const { shop, pub } = await setup();
    const a = await readyVideo(shop.id, "A", "gid://shopify/Video/1");
    fake.throttleNext = 2;
    expect(await pub.publishVideo(a.id)).toMatch(/Metaobject/);
  });
});
