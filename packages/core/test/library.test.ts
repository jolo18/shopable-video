import { beforeEach, describe, expect, it } from "vitest";
import { FakeShopify } from "../src/testing";
import { ShopifyFilesStore, UploadRejected } from "../src/videos/store";
import {
  deleteVideos,
  finalizeUpload,
  listVideos,
  PlanLimitError,
  startUploads,
  titleFromFilename,
  updateVideoDetails,
} from "../src/videos/library";
import { pollStatusHandler } from "../src/videos/jobs";
import { claim, RetryLater } from "../src/jobs/queue";
import { makeShop, prisma, resetDb } from "../../../test/db";

const mp4 = (i: number) => ({ filename: `clip_${i}.mp4`, mimeType: "video/mp4", size: 5_000_000 });

describe("video library", () => {
  let fake: FakeShopify;
  let store: ShopifyFilesStore;

  beforeEach(async () => {
    await resetDb();
    fake = new FakeShopify("lib.myshopify.com");
    store = new ShopifyFilesStore(fake.client());
  });

  it("uploads 20 videos in one go and they become ready", async () => {
    const shop = await makeShop("lib.myshopify.com", "starter");
    const started = await startUploads(shop, Array.from({ length: 20 }, (_, i) => mp4(i)), store);
    expect(started).toHaveLength(20);
    for (const s of started) await finalizeUpload(shop.id, s.videoId, s.target.resourceUrl, store);
    expect(await prisma.video.count({ where: { status: "processing" } })).toBe(20);

    const handler = pollStatusHandler(async () => fake.client());
    let jobs = await claim("t", 50, ["video.poll_status"]);
    expect(jobs).toHaveLength(20);
    // Still processing: the handler asks to retry later.
    await expect(handler(jobs[0])).rejects.toBeInstanceOf(RetryLater);

    fake.processAll();
    for (const j of jobs) await handler(j);
    const ready = await prisma.video.findMany({ where: { status: "ready" } });
    expect(ready).toHaveLength(20);
    expect(ready[0].posterUrl).toMatch(/preview/);
    expect((ready[0].sources as unknown[]).length).toBe(3);
  });

  it("rejects bad files and enforces the plan limit", async () => {
    const shop = await makeShop("lib.myshopify.com", "free");
    await expect(startUploads(shop, [{ filename: "a.avi", mimeType: "video/x-msvideo", size: 10 }], store)).rejects.toBeInstanceOf(UploadRejected);
    await expect(startUploads(shop, [{ ...mp4(1), size: 2 * 1024 ** 3 }], store)).rejects.toBeInstanceOf(UploadRejected);
    await expect(startUploads(shop, Array.from({ length: 16 }, (_, i) => mp4(i)), store)).rejects.toBeInstanceOf(PlanLimitError);
    expect(await prisma.video.count()).toBe(0);
  });

  it("marks failed processing", async () => {
    const shop = await makeShop("lib.myshopify.com", "starter");
    const [s] = await startUploads(shop, [mp4(1)], store);
    await finalizeUpload(shop.id, s.videoId, s.target.resourceUrl, store);
    fake.processAll("FAILED");
    const [job] = await claim("t", 1, ["video.poll_status"]);
    await pollStatusHandler(async () => fake.client())(job);
    const v = await prisma.video.findUniqueOrThrow({ where: { id: s.videoId } });
    expect(v.status).toBe("failed");
    expect(v.error).toBe("Corrupt file");
  });

  it("searches, filters, edits and deletes", async () => {
    const shop = await makeShop("lib.myshopify.com", "pro");
    const a = await prisma.video.create({ data: { shopId: shop.id, title: "Summer dress", status: "ready", shopifyFileId: "gid://shopify/Video/x" } });
    await prisma.video.create({ data: { shopId: shop.id, title: "Winter coat", status: "processing" } });
    await prisma.videoProduct.create({ data: { videoId: a.id, productId: "gid://shopify/Product/1" } });

    expect((await listVideos(shop.id, { q: "summer" })).total).toBe(1);
    expect((await listVideos(shop.id, { status: "processing" })).videos[0].title).toBe("Winter coat");
    expect((await listVideos(shop.id, { tagged: "untagged" })).total).toBe(1);

    await updateVideoDetails(shop.id, a.id, { title: "  Hot dress ", caption: "Linen" });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: a.id } })).title).toBe("Hot dress");

    const res = await deleteVideos(shop.id, [a.id], store);
    expect(res.productIds).toEqual(["gid://shopify/Product/1"]);
    expect(await prisma.video.count()).toBe(1);
  });

  it("does not let one shop touch another's videos", async () => {
    const a = await makeShop("a.myshopify.com", "pro");
    const b = await makeShop("b.myshopify.com", "pro");
    const v = await prisma.video.create({ data: { shopId: a.id, title: "mine" } });
    await expect(updateVideoDetails(b.id, v.id, { title: "x" })).rejects.toThrow();
    await deleteVideos(b.id, [v.id], store);
    expect(await prisma.video.count()).toBe(1);
  });

  it("titles from filenames", () => {
    expect(titleFromFilename("my_summer-look.final.MP4")).toBe("my summer look.final");
  });
});
