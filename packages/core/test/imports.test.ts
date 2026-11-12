import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeShopify } from "../src/testing";
import {
  FakeProvider,
  FallbackProvider,
  ProviderError,
  normalizeUsername,
  parseSocialUrl,
  type ImportProvider,
} from "../src/imports/provider";
import {
  RightsNotConfirmed,
  connectAccount,
  importVideoHandler,
  profileSyncHandler,
  queueLinkImports,
  queuePostImports,
  scheduleSyncs,
} from "../src/imports/pipeline";
import { claim } from "../src/jobs/queue";
import { EntitlementError } from "../src/tagging";
import { makeShop, prisma, resetDb } from "../../../test/db";

describe("social links", () => {
  it("parses Instagram and TikTok links", () => {
    expect(parseSocialUrl("https://www.instagram.com/reel/C9abc_DEF/?igsh=x")).toEqual({ platform: "instagram", externalId: "C9abc_DEF", username: null });
    expect(parseSocialUrl("https://www.tiktok.com/@shop.co/video/7301234567890123456")).toEqual({
      platform: "tiktok",
      externalId: "7301234567890123456",
      username: "shop.co",
    });
    expect(parseSocialUrl("https://vm.tiktok.com/ZMabc/")?.platform).toBe("tiktok");
    expect(parseSocialUrl("https://youtube.com/watch?v=1")).toBeNull();
    expect(parseSocialUrl("not a url")).toBeNull();
    expect(normalizeUsername("@Shop.Co")).toBe("shop.co");
    expect(normalizeUsername("https://instagram.com/shop.co/")).toBe("shop.co");
  });

  it("falls back to the next provider, but not on permanent errors", async () => {
    const broken: ImportProvider = {
      name: "broken",
      listProfile: async () => {
        throw new Error("down");
      },
      resolve: async () => {
        throw new ProviderError("private", true);
      },
      download: async () => {
        throw new Error("down");
      },
    };
    const p = new FallbackProvider([broken, new FakeProvider()]);
    expect(await p.listProfile("instagram", "x")).toHaveLength(6);
    await expect(p.resolve("https://instagram.com/reel/a")).rejects.toThrow("private");
  });
});

describe("import pipeline", () => {
  let fake: FakeShopify;
  let uploads: number;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeShopify("imp.myshopify.com");
    uploads = 0;
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://shopify-staged-uploads")) {
        uploads++;
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(null, { status: 201 });
      }
      return realFetch(url, init);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const handler = () => importVideoHandler(async () => fake.client(), new FakeProvider());

  it("imports a pasted reel link into the library, then dedupes it", async () => {
    const shop = await makeShop("imp.myshopify.com", "starter");
    await expect(queueLinkImports(shop, ["https://www.instagram.com/reel/ABC/"], false)).rejects.toBeInstanceOf(RightsNotConfirmed);
    await queueLinkImports(shop, ["https://www.instagram.com/reel/ABC/"], true);
    const [job] = await claim("t", 5, ["import.video"]);
    await handler()(job);

    const video = await prisma.video.findFirstOrThrow();
    expect(video).toMatchObject({ source: "instagram", sourceExternalId: "ABC", status: "processing" });
    expect(uploads).toBe(1);
    expect((await prisma.importJob.findFirstOrThrow()).status).toBe("done");
    expect(await claim("t", 5, ["video.poll_status"])).toHaveLength(1);

    await queueLinkImports(shop, ["https://instagram.com/reel/ABC"], true);
    const [again] = await claim("t", 5, ["import.video"]);
    await handler()(again);
    const second = await prisma.importJob.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(second).toMatchObject({ status: "duplicate", videoId: video.id });
    expect(await prisma.video.count()).toBe(1);
  });

  it("rejects bad links and respects the plan limit", async () => {
    const shop = await makeShop("imp.myshopify.com", "free");
    await expect(queueLinkImports(shop, ["https://example.com/x"], true)).rejects.toThrow(/Not an Instagram/);
    const posts = await new FakeProvider({ posts: 20 }).listProfile("tiktok", "brand", 20);
    await expect(queuePostImports(shop, posts.slice(0, 16), true)).rejects.toThrow(/plan allows 15/);
  });

  it("auto-sync is gated by plan and picks up the next day's post", async () => {
    const free = await makeShop("imp.myshopify.com", "free");
    await expect(
      connectAccount(free, { platform: "tiktok", username: "@brand", autoSync: true, rightsConfirmed: true }),
    ).rejects.toBeInstanceOf(EntitlementError);
    await prisma.shop.update({ where: { id: free.id }, data: { plan: "growth" } });
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: free.id } });
    const acct = await connectAccount(shop, { platform: "tiktok", username: "@brand", autoSync: true, rightsConfirmed: true });

    // Day 1: first sync imports the latest three posts.
    expect(await scheduleSyncs()).toBe(1);
    const provider = new FakeProvider({ posts: 4 });
    const [syncJob] = await claim("t", 5, ["import.profile_sync"]);
    await profileSyncHandler(provider)(syncJob);
    expect(await prisma.importJob.count()).toBe(3);
    for (const j of await claim("t", 10, ["import.video"])) await importVideoHandler(async () => fake.client(), provider)(j);
    expect(await prisma.video.count()).toBe(3);

    // Not due again until a day later.
    expect(await scheduleSyncs()).toBe(0);

    // Day 2: a new post appears after the last sync.
    await prisma.socialAccount.update({ where: { id: acct.id }, data: { lastSyncedAt: new Date(Date.UTC(2026, 10, 4, 12)) } });
    const nextDay = new FakeProvider({ posts: 5 });
    const later = Date.now() + 25 * 3600_000;
    expect(await scheduleSyncs(later)).toBe(1);
    const [sync2] = await claim("t", 5, ["import.profile_sync"]);
    await profileSyncHandler(nextDay)(sync2);
    const queued = await claim("t", 10, ["import.video"]);
    expect(queued).toHaveLength(1);
    await importVideoHandler(async () => fake.client(), nextDay)(queued[0]);
    expect(await prisma.video.count()).toBe(4);
  });
});
