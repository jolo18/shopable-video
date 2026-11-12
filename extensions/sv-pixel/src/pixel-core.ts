/** Pure parts of the pixel, kept apart for tests. */
import { MAX_BATCH_EVENTS, SV_PIXEL_EVENT, type EventBatch } from "@sv/shared";

export { SV_PIXEL_EVENT };

export interface PendingEvent {
  clientId: string;
  event: Record<string, unknown>;
}

const numeric = (id: unknown) => {
  const m = String(id ?? "").match(/(\d+)$/);
  return m ? m[1] : "";
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function checkoutEvent(checkout: any): Record<string, unknown> | null {
  const orderId = numeric(checkout?.order?.id);
  if (!orderId) return null;
  const lines = (checkout.lineItems ?? [])
    .map((l: any) => ({
      productId: numeric(l?.variant?.product?.id),
      variantId: numeric(l?.variant?.id) || undefined,
      quantity: Number(l?.quantity ?? 0),
      price: Number(l?.finalLinePrice?.amount ?? Number(l?.variant?.price?.amount ?? 0) * Number(l?.quantity ?? 0)),
    }))
    .filter((l: { productId: string; quantity: number }) => l.productId && l.quantity > 0)
    .slice(0, 100);
  return {
    type: "checkout_completed",
    ts: Date.now(),
    value: Number(checkout?.totalPrice?.amount ?? 0),
    order: { orderId, currency: String(checkout?.currencyCode ?? "USD"), lines },
  };
}

/** One batch per client id, at most MAX_BATCH_EVENTS each. */
export function buildBatches(shop: string, pending: PendingEvent[]): EventBatch[] {
  const byClient = new Map<string, Array<Record<string, unknown>>>();
  for (const p of pending) {
    if (!p.clientId) continue;
    const list = byClient.get(p.clientId) ?? [];
    list.push(p.event);
    byClient.set(p.clientId, list);
  }
  const out: EventBatch[] = [];
  for (const [clientId, events] of byClient) {
    for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
      out.push({ shop, clientId, events: events.slice(i, i + MAX_BATCH_EVENTS) as unknown as EventBatch["events"] });
    }
  }
  return out;
}
