import { prisma, type Db } from "../db";
import type { ClientFor } from "../deps";
import { PermanentError, RetryLater, type ClaimedJob } from "../jobs/queue";
import { refreshVideoStatus } from "./library";
import { ShopifyFilesStore } from "./store";

export const POLL_INTERVAL_MS = 5_000;

/**
 * video.poll_status: waits for Shopify to finish processing an uploaded
 * video. `onReady` lets the caller publish the video once it is playable.
 */
export function pollStatusHandler(
  clientFor: ClientFor,
  onReady?: (videoId: string) => Promise<void>,
  db: Db = prisma,
) {
  return async (job: ClaimedJob) => {
    const videoId = String(job.payload.videoId ?? "");
    const deadline = Number(job.payload.deadline ?? 0);
    const video = await db.video.findUnique({ where: { id: videoId }, include: { shop: true } });
    if (!video) return; // deleted meanwhile
    const store = new ShopifyFilesStore(await clientFor(video.shop.domain));
    const status = await refreshVideoStatus(videoId, store, db);
    if (status === "ready") {
      await onReady?.(videoId);
      return;
    }
    if (status === "failed" || status === "missing") return;
    if (deadline && Date.now() > deadline) {
      await db.video.update({
        where: { id: videoId },
        data: { status: "failed", error: "Shopify took too long to process this video" },
      });
      throw new PermanentError("processing timed out");
    }
    throw new RetryLater(POLL_INTERVAL_MS);
  };
}
