import { onVideoReady, pollStatusHandler, prisma, publishAll, ShopifyPublisher, type ClientFor } from "@sv/core";
import type { Handlers } from "./runner";

export interface HandlerDeps {
  clientFor: ClientFor;
}

export async function publisherForShop(clientFor: ClientFor, shopId: string) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  return new ShopifyPublisher(shop, await clientFor(shop.domain));
}

export function buildHandlers(deps?: HandlerDeps): Handlers {
  const clientFor = deps?.clientFor ?? lazyClientFor();
  return {
    "video.poll_status": pollStatusHandler(clientFor, async (videoId) => {
      const v = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
      await onVideoReady(await publisherForShop(clientFor, v.shopId), v.shopId, videoId);
    }),
    "shop.publish_all": async (job) => {
      if (!job.shopId) return;
      await publishAll(await publisherForShop(clientFor, job.shopId), job.shopId);
    },
  };
}

/** Loads the Shopify app library only when a job needs it. */
function lazyClientFor(): ClientFor {
  return async (shop) => (await import("./shopify")).clientFor(shop);
}
