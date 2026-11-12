import {
  attributeOrders,
  cleanupEvents,
  importVideoHandler,
  profileSyncHandler,
  providerFromEnv,
  scheduleSyncs,
  onVideoReady,
  pollStatusHandler,
  prisma,
  publishAll,
  rollup,
  ShopifyPublisher,
  type ClientFor,
  type ImportProvider,
} from "@sv/core";
import type { Handlers } from "./runner";

export interface HandlerDeps {
  clientFor: ClientFor;
  provider?: ImportProvider;
}

export async function publisherForShop(clientFor: ClientFor, shopId: string) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  return new ShopifyPublisher(shop, await clientFor(shop.domain));
}

export function buildHandlers(deps?: HandlerDeps): Handlers {
  const clientFor = deps?.clientFor ?? lazyClientFor();
  const provider = deps?.provider ?? providerFromEnv();
  return {
    "import.video": importVideoHandler(clientFor, provider),
    "import.profile_sync": profileSyncHandler(provider),
    "sync.schedule": async () => {
      await scheduleSyncs();
    },
    "video.poll_status": pollStatusHandler(clientFor, async (videoId) => {
      const v = await prisma.video.findUniqueOrThrow({ where: { id: videoId } });
      await onVideoReady(await publisherForShop(clientFor, v.shopId), v.shopId, videoId);
    }),
    "shop.publish_all": async (job) => {
      if (!job.shopId) return;
      await publishAll(await publisherForShop(clientFor, job.shopId), job.shopId);
    },
    // Attribute first so the rollup sees new orders.
    "stats.attribute": async () => {
      await attributeOrders();
    },
    "stats.rollup": async () => {
      await attributeOrders();
      await rollup();
    },
    "events.cleanup": async () => {
      await cleanupEvents();
    },
  };
}

/** Loads the Shopify app library only when a job needs it. */
function lazyClientFor(): ClientFor {
  return async (shop) => (await import("./shopify")).clientFor(shop);
}
