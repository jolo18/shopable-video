/**
 * Web pixel (plan, C3): subscribes to widget events and checkout events,
 * batches them with Shopify's anonymous client id and beacons them to ingest.
 * Runs in Shopify's sandbox, only with the shopper's analytics consent.
 */
import { register } from "@shopify/web-pixels-extension";
import { SV_PIXEL_EVENT, buildBatches, checkoutEvent, type PendingEvent } from "./pixel-core";

register(({ analytics, browser, settings }) => {
  const ingestUrl = String(settings.ingestUrl ?? "").replace(/\/$/, "");
  const shop = String(settings.shop ?? "");
  if (!ingestUrl || !shop) return;

  let queue: PendingEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    const pending = queue;
    queue = [];
    for (const batch of buildBatches(shop, pending)) {
      const body = JSON.stringify(batch);
      const ok = await browser.sendBeacon(`${ingestUrl}/v1/events`, body).catch(() => false);
      if (!ok) {
        await fetch(`${ingestUrl}/v1/events`, { method: "POST", body, keepalive: true }).catch(() => {});
      }
    }
  }

  function push(e: PendingEvent, now = false) {
    queue.push(e);
    if (now || queue.length >= 20) void flush();
    else timer ??= setTimeout(() => void flush(), 3000);
  }

  analytics.subscribe(SV_PIXEL_EVENT, (event) => {
    const data = (event.customData ?? {}) as Record<string, unknown>;
    // Flush right away on add to cart, since the shopper may leave the page.
    push({ clientId: event.clientId, event: data }, data.type === "sv_add_to_cart");
  });

  analytics.subscribe("checkout_started", (event) => {
    push({ clientId: event.clientId, event: { type: "checkout_started", ts: Date.now(), value: Number(event.data?.checkout?.totalPrice?.amount ?? 0) } }, true);
  });

  analytics.subscribe("checkout_completed", (event) => {
    const e = checkoutEvent(event.data?.checkout);
    if (e) push({ clientId: event.clientId, event: e }, true);
  });
});
