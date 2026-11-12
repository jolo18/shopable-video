/**
 * Event publisher (plan, C3): widget events go through
 * Shopify.analytics.publish so the web pixel forwards them, under the
 * merchant's consent settings.
 */
import { SV_PIXEL_EVENT, type WidgetEventType } from "@sv/shared";

export interface SvDetail {
  widgetId?: string;
  videoId?: string;
  productId?: string;
  value?: number;
}

type Analytics = { publish?: (name: string, data: unknown) => void };

export function track(type: WidgetEventType, d: SvDetail = {}) {
  const analytics = (window as unknown as { Shopify?: { analytics?: Analytics } }).Shopify?.analytics;
  const payload = { type, ts: Date.now(), ...d };
  try {
    analytics?.publish?.(SV_PIXEL_EVENT, payload);
  } catch {
    /* never break the page for analytics */
  }
  // Public hook for merchants and tests.
  document.dispatchEvent(new CustomEvent("sv:event", { detail: payload }));
}
