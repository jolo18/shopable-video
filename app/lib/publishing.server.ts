import {
  deleteVideos,
  onVideoEdited,
  onVideoProductsChanged,
  onVideosDeleted,
  productSummaries as fetchSummaries,
  setVideoProducts,
  ShopifyPublisher,
} from "@sv/core";
import type { adminContext } from "./context.server";

export type AdminCtx = Awaited<ReturnType<typeof adminContext>>;

export function publisherFor(ctx: AdminCtx) {
  return new ShopifyPublisher(ctx.shop, ctx.client);
}

/** Deletes videos, then removes them from the storefront copy. */
export async function deleteAndUnpublish(ctx: AdminCtx, ids: string[]) {
  const result = await deleteVideos(ctx.shop.id, ids, ctx.store);
  await onVideosDeleted(publisherFor(ctx), ctx.shop.id, result);
  return result;
}

export async function publishVideoChange(ctx: AdminCtx, videoId: string) {
  await onVideoEdited(publisherFor(ctx), videoId);
}

export async function saveVideoProducts(ctx: AdminCtx, videoId: string, productIds: string[]) {
  const { touched } = await setVideoProducts(ctx.shop, videoId, productIds);
  await onVideoProductsChanged(publisherFor(ctx), videoId, touched);
}

export function productSummaries(ctx: AdminCtx, ids: string[]) {
  return fetchSummaries(ctx.client, ids);
}
