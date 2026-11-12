/**
 * Import pipeline (plan, C3): one job per video: fetch, dedupe, upload,
 * wait for Shopify processing, save to library. Plus the daily sync of
 * connected usernames (feature 4).
 */
import { PLANS, entitlementsFor } from "@sv/shared";
import { prisma, type Db } from "../db";
import type { ClientFor } from "../deps";
import { enqueue, PermanentError, type ClaimedJob } from "../jobs/queue";
import { assertCanAdd, PlanLimitError } from "../videos/library";
import { ShopifyFilesStore, checkUpload } from "../videos/store";
import { EntitlementError } from "../tagging";
import {
  normalizeUsername,
  parseSocialUrl,
  ProviderError,
  type ImportProvider,
  type Platform,
  type SocialPost,
} from "./provider";

export const SYNC_EVERY_MS = 24 * 60 * 60_000;
const AUTO_SYNC_PLANS = Object.values(PLANS)
  .filter((p) => p.entitlements.autoSync)
  .map((p) => p.key as string);
const MAX_LINKS = 25;

export class RightsNotConfirmed extends Error {
  constructor() {
    super("Confirm you have the rights to use these videos before importing.");
    this.name = "RightsNotConfirmed";
  }
}

async function queueOne(
  shopId: string,
  url: string,
  post: SocialPost | null,
  socialAccountId: string | null,
  db: Db,
) {
  const job = await db.importJob.create({
    data: { shopId, sourceUrl: url, socialAccountId, rightsConfirmedAt: new Date(), status: "queued" },
  });
  await enqueue("import.video", { importJobId: job.id, post }, { shopId, maxAttempts: 4 }, db);
  return job;
}

/** Paste one or more links (feature 2). */
export async function queueLinkImports(
  shop: { id: string; plan: string },
  urls: string[],
  rightsConfirmed: boolean,
  db: Db = prisma,
) {
  if (!rightsConfirmed) throw new RightsNotConfirmed();
  const clean = [...new Set(urls.map((u) => u.trim()).filter(Boolean))].slice(0, MAX_LINKS);
  const bad = clean.filter((u) => !parseSocialUrl(u));
  if (bad.length) throw new ProviderError(`Not an Instagram or TikTok video link: ${bad[0]}`, true);
  await assertCanAdd(shop, clean.length, db);
  const jobs = [];
  for (const u of clean) jobs.push(await queueOne(shop.id, u, null, null, db));
  return jobs;
}

/** Picked from a profile (feature 3) or found by the daily sync. */
export async function queuePostImports(
  shop: { id: string; plan: string },
  posts: SocialPost[],
  rightsConfirmed: boolean,
  socialAccountId: string | null = null,
  db: Db = prisma,
) {
  if (!rightsConfirmed) throw new RightsNotConfirmed();
  const fresh: SocialPost[] = [];
  for (const p of posts) {
    const exists = await db.video.findFirst({
      where: { shopId: shop.id, source: p.platform, sourceExternalId: p.externalId },
      select: { id: true },
    });
    if (!exists) fresh.push(p);
  }
  await assertCanAdd(shop, fresh.length, db);
  const jobs = [];
  for (const p of fresh.slice(0, 50)) jobs.push(await queueOne(shop.id, p.url, p, socialAccountId, db));
  return jobs;
}

function titleFromCaption(caption: string) {
  const first = caption.split("\n")[0].replace(/#[\p{L}\d_]+/gu, "").replace(/\s+/g, " ").trim();
  return (first || "Imported video").slice(0, 80);
}

async function setStatus(id: string, status: string, extra: { error?: string | null; videoId?: string } = {}, db: Db = prisma) {
  await db.importJob.update({ where: { id }, data: { status, ...extra } });
}

/** import.video */
export function importVideoHandler(clientFor: ClientFor, provider: ImportProvider, db: Db = prisma) {
  return async (job: ClaimedJob) => {
    const importJobId = String(job.payload.importJobId ?? "");
    const ij = await db.importJob.findUnique({ where: { id: importJobId }, include: { shop: true } });
    if (!ij || ij.status === "done" || ij.status === "duplicate") return;
    const lastAttempt = job.attempts >= job.maxAttempts;

    try {
      await setStatus(ij.id, "fetching", { error: null }, db);
      const post = (job.payload.post as SocialPost | null) ?? (await provider.resolve(ij.sourceUrl));

      const dupe = await db.video.findFirst({
        where: { shopId: ij.shopId, source: post.platform, sourceExternalId: post.externalId },
      });
      if (dupe) {
        await setStatus(ij.id, "duplicate", { videoId: dupe.id }, db);
        return;
      }
      await assertCanAdd(ij.shop, 1, db);

      const file = await provider.download(post);
      const meta = { filename: file.filename, mimeType: file.mimeType, size: file.data.size };
      checkUpload(meta, "video");

      await setStatus(ij.id, "uploading", {}, db);
      const store = new ShopifyFilesStore(await clientFor(ij.shop.domain));
      const target = await store.createUpload(meta, "video");
      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append("file", file.data, file.filename);
      const up = await fetch(target.url, { method: "POST", body: form });
      if (!up.ok) throw new Error(`Upload to Shopify failed (${up.status})`);
      const created = await store.finalize(target.resourceUrl, { kind: "video", alt: post.caption.slice(0, 200) });

      const video = await db.video.create({
        data: {
          shopId: ij.shopId,
          title: titleFromCaption(post.caption),
          caption: post.caption.slice(0, 2000),
          source: post.platform,
          sourceUrl: post.url,
          sourceExternalId: post.externalId,
          shopifyFileId: created.id,
          originalFilename: file.filename,
          fileSize: BigInt(file.data.size),
          status: "processing",
        },
      });
      await enqueue(
        "video.poll_status",
        { videoId: video.id, deadline: Date.now() + 60 * 60_000 },
        { shopId: ij.shopId, dedupeKey: `poll:${video.id}` },
        db,
      );
      await setStatus(ij.id, "done", { videoId: video.id }, db);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const permanent =
        (err instanceof ProviderError && err.permanent) || err instanceof PlanLimitError || (err as Error).name === "UploadRejected";
      if (permanent || lastAttempt) {
        await setStatus(ij.id, "failed", { error: message.slice(0, 500) }, db);
        if (permanent) throw new PermanentError(message);
      } else {
        await setStatus(ij.id, "queued", { error: `Retrying: ${message}`.slice(0, 500) }, db);
      }
      throw err;
    }
  };
}

/** Connect a username for browsing and, on plans that allow it, daily sync. */
export async function connectAccount(
  shop: { id: string; plan: string },
  input: { platform: Platform; username: string; autoSync: boolean; rightsConfirmed: boolean },
  db: Db = prisma,
) {
  if (input.autoSync && !input.rightsConfirmed) throw new RightsNotConfirmed();
  if (input.autoSync && !entitlementsFor(shop.plan).autoSync) {
    throw new EntitlementError("Daily auto-sync is on the Growth and Pro plans.");
  }
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9._]{1,64}$/.test(username)) throw new ProviderError("Enter a valid username", true);
  return db.socialAccount.upsert({
    where: { shopId_platform_username: { shopId: shop.id, platform: input.platform, username } },
    create: { shopId: shop.id, platform: input.platform, username, autoSync: input.autoSync },
    update: { autoSync: input.autoSync },
  });
}

/** import.profile_sync: queue new posts from one connected account. */
export function profileSyncHandler(provider: ImportProvider, db: Db = prisma) {
  return async (job: ClaimedJob) => {
    const acct = await db.socialAccount.findUnique({
      where: { id: String(job.payload.socialAccountId ?? "") },
      include: { shop: true },
    });
    if (!acct || !acct.autoSync || acct.shop.uninstalledAt) return;
    if (!entitlementsFor(acct.shop.plan).autoSync) return;
    const posts = await provider.listProfile(acct.platform as Platform, acct.username, 12);
    const since = acct.lastSyncedAt;
    // First sync takes the latest few; later syncs take what's new.
    const candidates = since
      ? posts.filter((p) => !p.postedAt || new Date(p.postedAt) > since)
      : posts.slice(0, 3);
    try {
      // Rights were confirmed when auto-sync was turned on.
      await queuePostImports(acct.shop, candidates, true, acct.id, db);
    } catch (err) {
      if (!(err instanceof PlanLimitError)) throw err;
    }
    await db.socialAccount.update({ where: { id: acct.id }, data: { lastSyncedAt: new Date() } });
  };
}

/** sync.schedule: queue profile syncs that are due. */
export async function scheduleSyncs(now = Date.now(), db: Db = prisma) {
  const due = await db.socialAccount.findMany({
    where: {
      autoSync: true,
      shop: { uninstalledAt: null, plan: { in: AUTO_SYNC_PLANS } },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now - SYNC_EVERY_MS) } }],
    },
    select: { id: true, shopId: true },
  });
  for (const a of due) {
    const day = Math.floor(now / SYNC_EVERY_MS);
    await enqueue("import.profile_sync", { socialAccountId: a.id }, { shopId: a.shopId, dedupeKey: `sync:${a.id}:${day}` }, db);
  }
  return due.length;
}
