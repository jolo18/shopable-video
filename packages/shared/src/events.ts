/**
 * SvEvent: one shape in the widget, the web pixel and ingest (plan, C4).
 * The widget publishes these with Shopify.analytics.publish; the pixel
 * forwards them, plus checkout events, to ingest in batches.
 */

export const WIDGET_EVENT_TYPES = [
  "sv_impression", // a widget scrolled into view
  "sv_view", // a video started playing in the full player
  "sv_watch", // value = milliseconds watched in one session of the player
  "sv_complete", // a video played to the end
  "sv_click", // a product card or button was tapped
  "sv_add_to_cart", // value = line price
  "sv_share",
] as const;

export const CHECKOUT_EVENT_TYPES = [
  "checkout_started",
  "checkout_completed",
] as const;

export type WidgetEventType = (typeof WIDGET_EVENT_TYPES)[number];
export type CheckoutEventType = (typeof CHECKOUT_EVENT_TYPES)[number];
export type SvEventType = WidgetEventType | CheckoutEventType;

export const SV_EVENT_TYPES: readonly SvEventType[] = [
  ...WIDGET_EVENT_TYPES,
  ...CHECKOUT_EVENT_TYPES,
];

/** Custom event name used with Shopify.analytics.publish. */
export const SV_PIXEL_EVENT = "sv:event";

export interface OrderLine {
  productId: string;
  variantId?: string;
  quantity: number;
  /** Line total in shop currency */
  price: number;
}

export interface OrderPayload {
  orderId: string;
  currency: string;
  lines: OrderLine[];
}

export interface SvEvent {
  type: SvEventType;
  shop: string;
  widgetId?: string;
  videoId?: string;
  productId?: string;
  value?: number;
  /** Epoch milliseconds */
  ts: number;
  /** Only on checkout_completed */
  order?: OrderPayload;
}

/** What the pixel beacons to ingest. */
export interface EventBatch {
  shop: string;
  clientId: string;
  events: SvEvent[];
}

export const MAX_BATCH_EVENTS = 50;
const MAX_ID = 128;
const MAX_LINES = 100;
/** Events older than this, or further in the future, are dropped. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 10 * 60 * 1000;

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
}

function optId(v: unknown): boolean {
  return v === undefined || v === null || isId(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isShopDomain(v: unknown): v is string {
  return typeof v === "string" && v.length <= 255 && SHOP_RE.test(v);
}

function validOrder(o: unknown): o is OrderPayload {
  if (!o || typeof o !== "object") return false;
  const order = o as Record<string, unknown>;
  if (!isId(order.orderId)) return false;
  if (typeof order.currency !== "string" || !/^[A-Z]{3}$/.test(order.currency))
    return false;
  if (!Array.isArray(order.lines) || order.lines.length > MAX_LINES)
    return false;
  return order.lines.every((l: unknown) => {
    if (!l || typeof l !== "object") return false;
    const line = l as Record<string, unknown>;
    return (
      isId(line.productId) &&
      optId(line.variantId) &&
      isFiniteNum(line.quantity) &&
      line.quantity > 0 &&
      isFiniteNum(line.price) &&
      line.price >= 0
    );
  });
}

export type ValidationResult =
  | { ok: true; batch: EventBatch; dropped: number }
  | { ok: false; error: string };

/**
 * Validates a batch from the pixel. Bad batches are rejected; bad events
 * inside a good batch are dropped and counted.
 */
export function validateBatch(
  input: unknown,
  now: number = Date.now(),
): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "body" };
  const b = input as Record<string, unknown>;
  if (!isShopDomain(b.shop)) return { ok: false, error: "shop" };
  if (!isId(b.clientId)) return { ok: false, error: "clientId" };
  if (!Array.isArray(b.events)) return { ok: false, error: "events" };
  if (b.events.length === 0) return { ok: false, error: "empty" };
  if (b.events.length > MAX_BATCH_EVENTS) return { ok: false, error: "size" };

  const events: SvEvent[] = [];
  let dropped = 0;
  for (const raw of b.events) {
    const e = normalizeEvent(raw, b.shop, now);
    if (e) events.push(e);
    else dropped++;
  }
  if (events.length === 0) return { ok: false, error: "no valid events" };
  return {
    ok: true,
    batch: { shop: b.shop, clientId: b.clientId, events },
    dropped,
  };
}

function normalizeEvent(
  raw: unknown,
  shop: string,
  now: number,
): SvEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!SV_EVENT_TYPES.includes(e.type as SvEventType)) return null;
  if (e.shop !== undefined && e.shop !== shop) return null;
  if (!isFiniteNum(e.ts)) return null;
  if (e.ts < now - MAX_AGE_MS || e.ts > now + MAX_SKEW_MS) return null;
  if (!optId(e.widgetId) || !optId(e.videoId) || !optId(e.productId))
    return null;
  if (e.value !== undefined && e.value !== null && !isFiniteNum(e.value))
    return null;

  const type = e.type as SvEventType;
  if (type === "checkout_completed" && !validOrder(e.order)) return null;

  const out: SvEvent = { type, shop, ts: e.ts };
  if (isId(e.widgetId)) out.widgetId = e.widgetId;
  if (isId(e.videoId)) out.videoId = e.videoId;
  if (isId(e.productId)) out.productId = e.productId;
  if (isFiniteNum(e.value)) out.value = e.value;
  if (type === "checkout_completed") out.order = e.order as OrderPayload;
  return out;
}
