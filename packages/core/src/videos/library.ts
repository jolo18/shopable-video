/**
 * Library and upload services (plan, C3; features 1, 7, 8, 9).
 * The browser uploads straight to Shopify's staged upload target; we only
 * hand out targets, then call fileCreate and track processing.
 */
import type { Prisma } from "@prisma/client";
import { entitlementsFor, videosRemaining } from "@sv/shared";
import { prisma, type Db } from "../db";
import { enqueue } from "../jobs/queue";
import {
  checkUpload,
  UploadRejected,
  type StoredFile,
  type UploadFile,
  type UploadTarget,
  type VideoStore,
} from "./store";

export const VIDEO_STATUSES = ["uploading", "processing", "ready", "failed"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** Videos that count toward the plan limit. */
export async function countVideos(shopId: string, db: Db = prisma) {
  return db.video.count({ where: { shopId, status: { not: "failed" } } });
}

export function titleFromFilename(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export class PlanLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Your plan allows ${limit} videos. Upgrade to add more.`);
    this.name = "PlanLimitError";
  }
}

export async function assertCanAdd(
  shop: { id: string; plan: string },
  adding: number,
  db: Db = prisma,
) {
  const ent = entitlementsFor(shop.plan);
  if (ent.maxVideos === null) return;
  const left = videosRemaining(ent, await countVideos(shop.id, db));
  if (adding > left) throw new PlanLimitError(ent.maxVideos);
}

export interface StartedUpload {
  videoId: string;
  filename: string;
  target: UploadTarget;
}

/** Step 1: validate, check the plan, reserve rows and get upload targets. */
export async function startUploads(
  shop: { id: string; plan: string },
  files: UploadFile[],
  store: VideoStore,
  db: Db = prisma,
): Promise<StartedUpload[]> {
  if (files.length === 0) return [];
  if (files.length > 50) throw new UploadRejected("Upload at most 50 files at a time");
  files.forEach((f) => checkUpload(f, "video"));
  await assertCanAdd(shop, files.length, db);

  const targets = await store.createUploads(files, "video");
  const out: StartedUpload[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const video = await db.video.create({
      data: {
        shopId: shop.id,
        title: titleFromFilename(f.filename),
        originalFilename: f.filename.slice(0, 255),
        fileSize: BigInt(f.size),
        source: "upload",
        status: "uploading",
      },
      select: { id: true },
    });
    out.push({ videoId: video.id, filename: f.filename, target: targets[i] });
  }
  return out;
}

/** Step 2: the browser finished the upload; create the Shopify file. */
export async function finalizeUpload(
  shopId: string,
  videoId: string,
  resourceUrl: string,
  store: VideoStore,
  db: Db = prisma,
) {
  const video = await db.video.findFirst({ where: { id: videoId, shopId } });
  if (!video) throw new Error("Video not found");
  if (video.shopifyFileId) return video; // already finalized (retry)
  try {
    const file = await store.finalize(resourceUrl, { kind: "video", alt: video.title });
    const updated = await db.video.update({
      where: { id: video.id },
      data: { shopifyFileId: file.id, status: "processing", error: null },
    });
    await enqueue(
      "video.poll_status",
      { videoId: video.id, deadline: Date.now() + 60 * 60_000 },
      { shopId, dedupeKey: `poll:${video.id}` },
      db,
    );
    return updated;
  } catch (err) {
    await db.video.update({
      where: { id: video.id },
      data: { status: "failed", error: String((err as Error).message ?? err).slice(0, 500) },
    });
    throw err;
  }
}

/** Upload failed in the browser: mark the reserved row. */
export async function abandonUpload(shopId: string, videoId: string, reason: string, db: Db = prisma) {
  await db.video.updateMany({
    where: { id: videoId, shopId, status: "uploading" },
    data: { status: "failed", error: reason.slice(0, 500) },
  });
}

export function applyFile(file: StoredFile): Prisma.VideoUpdateInput {
  if (file.status === "READY") {
    return {
      status: "ready",
      error: null,
      posterUrl: file.posterUrl ?? null,
      durationMs: file.durationMs ?? null,
      width: file.width ?? null,
      height: file.height ?? null,
      sources: (file.sources ?? []) as unknown as Prisma.InputJsonValue,
    };
  }
  if (file.status === "FAILED") {
    return { status: "failed", error: file.error ?? "Shopify could not process this video" };
  }
  return { status: "processing" };
}

/** Reads the file from Shopify and stores what it reports. */
export async function refreshVideoStatus(
  videoId: string,
  store: VideoStore,
  db: Db = prisma,
): Promise<VideoStatus | "missing"> {
  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video?.shopifyFileId) return "missing";
  const file = await store.get(video.shopifyFileId);
  if (!file) {
    await db.video.update({
      where: { id: video.id },
      data: { status: "failed", error: "The file was deleted from Shopify Files" },
    });
    return "failed";
  }
  const updated = await db.video.update({ where: { id: video.id }, data: applyFile(file) });
  return updated.status as VideoStatus;
}

export interface ListFilters {
  q?: string;
  status?: VideoStatus | "";
  source?: string;
  /** "tagged" = has products, "untagged" = none */
  tagged?: "tagged" | "untagged" | "";
  sort?: "newest" | "oldest" | "title";
  page?: number;
  pageSize?: number;
}

export async function listVideos(shopId: string, f: ListFilters = {}, db: Db = prisma) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where: Prisma.VideoWhereInput = { shopId };
  if (f.q?.trim()) {
    const q = f.q.trim().slice(0, 100);
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { caption: { contains: q, mode: "insensitive" } },
      { originalFilename: { contains: q, mode: "insensitive" } },
    ];
  }
  if (f.status) where.status = f.status;
  if (f.source) where.source = f.source;
  if (f.tagged === "tagged") where.products = { some: {} };
  if (f.tagged === "untagged") where.products = { none: {} };

  const orderBy: Prisma.VideoOrderByWithRelationInput =
    f.sort === "oldest" ? { createdAt: "asc" } : f.sort === "title" ? { title: "asc" } : { createdAt: "desc" };

  const [total, videos] = await Promise.all([
    db.video.count({ where }),
    db.video.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { products: { orderBy: { position: "asc" } }, _count: { select: { widgets: true } } },
    }),
  ]);
  return { total, page, pageSize, videos };
}

export async function getVideo(shopId: string, id: string, db: Db = prisma) {
  return db.video.findFirst({
    where: { id, shopId },
    include: { products: { orderBy: { position: "asc" } } },
  });
}

export async function updateVideoDetails(
  shopId: string,
  id: string,
  input: { title?: string; caption?: string },
  db: Db = prisma,
) {
  const data: Prisma.VideoUpdateInput = {};
  if (typeof input.title === "string") data.title = input.title.trim().slice(0, 120);
  if (typeof input.caption === "string") data.caption = input.caption.slice(0, 2000);
  const res = await db.video.updateMany({ where: { id, shopId }, data });
  if (res.count === 0) throw new Error("Video not found");
  return getVideo(shopId, id, db);
}

/** Cover image: upload target for an image, then attach it. */
export async function startCoverUpload(file: UploadFile, store: VideoStore) {
  return store.createUpload(file, "image");
}

export async function attachCover(
  shopId: string,
  videoId: string,
  resourceUrl: string,
  store: VideoStore,
  db: Db = prisma,
) {
  const video = await getVideo(shopId, videoId, db);
  if (!video) throw new Error("Video not found");
  const file = await store.finalize(resourceUrl, { kind: "image", alt: video.title });
  await db.video.update({
    where: { id: videoId },
    data: { coverFileId: file.id, coverUrl: null },
  });
  return file.id;
}

export async function clearCover(shopId: string, videoId: string, db: Db = prisma) {
  await db.video.updateMany({ where: { id: videoId, shopId }, data: { coverFileId: null, coverUrl: null } });
}

/**
 * Deletes videos from the library and from Shopify Files. The caller
 * republishes affected widgets and products (see publishing.ts).
 */
export async function deleteVideos(
  shopId: string,
  ids: string[],
  store: VideoStore,
  db: Db = prisma,
) {
  const videos = await db.video.findMany({
    where: { shopId, id: { in: ids } },
    include: { products: true, widgets: true },
  });
  const fileIds = videos.flatMap((v) => (v.shopifyFileId ? [v.shopifyFileId] : []));
  await store.remove(fileIds);
  await db.video.deleteMany({ where: { shopId, id: { in: videos.map((v) => v.id) } } });
  return {
    deleted: videos.map((v) => v.id),
    metaobjectIds: videos.flatMap((v) => (v.metaobjectId ? [v.metaobjectId] : [])),
    productIds: [...new Set(videos.flatMap((v) => v.products.map((p) => p.productId)))],
    widgetIds: [...new Set(videos.flatMap((v) => v.widgets.map((w) => w.widgetId)))],
  };
}

export async function usage(shop: { id: string; plan: string }, db: Db = prisma) {
  const ent = entitlementsFor(shop.plan);
  const used = await countVideos(shop.id, db);
  return { used, limit: ent.maxVideos };
}
