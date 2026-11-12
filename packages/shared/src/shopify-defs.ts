/**
 * Names of the app-owned Shopify data the Publisher writes and the theme
 * extension reads. Definitions are declared in shopify.app.toml
 * ([metaobjects.app.*], [product.metafields.app.*], ...). Keep the two in sync.
 *
 * Liquid reads them as:
 *   product.metafields["$app"].videos       list of sv_video
 *   collection.metafields["$app"].widget    one sv_widget
 *   metaobjects["$app:sv_widget"][handle]
 *   app.metafields.sv.config                app-data (AppInstallation) JSON
 */

export const SV_VIDEO_TYPE = "$app:sv_video";
export const SV_WIDGET_TYPE = "$app:sv_widget";

export const APP_NAMESPACE = "$app";
export const PRODUCT_VIDEOS_KEY = "videos";
export const COLLECTION_WIDGET_KEY = "widget";

/** App-data metafield on the AppInstallation */
export const CONFIG_NAMESPACE = "sv";
export const CONFIG_KEY = "config";

/** Field keys on sv_video */
export const VIDEO_FIELDS = {
  video: "video", // file_reference (Video)
  title: "title",
  caption: "caption",
  cover: "cover", // file_reference (MediaImage), optional
  products: "products", // list.product_reference
  appId: "app_id", // our Postgres id, for events
} as const;

/** Field keys on sv_widget */
export const WIDGET_FIELDS = {
  name: "name",
  type: "type",
  videos: "videos", // list.metaobject_reference<$app:sv_video>
  settings: "settings", // json (WidgetSettings)
  rules: "rules", // json (ShowRules)
  appId: "app_id",
} as const;

/** Shop-wide storefront config published to the app-data metafield. */
export interface StorefrontConfig {
  /** Show the "Powered by" badge (from Entitlements.branding) */
  branding: boolean;
  /** Ingest URL the web pixel beacons to */
  ingestUrl: string;
  /** What happens after add to cart */
  cartMode: "drawer" | "cart_page" | "stay";
  /** Merchant CSS, printed as-is by the app embed; target .sv-root */
  customCss: string;
  /** locale -> key -> text overrides */
  translations: Record<string, Record<string, string>>;
  /** Handle of the widget the app embed shows as a floating pop-up */
  popupWidget: string | null;
  /** Public Storefront API token for the page-builder embed */
  storefrontToken: string;
  /** Resolved sv_widget type ("app--123--sv_widget") for the Storefront API */
  widgetType: string;
}

export const MAX_CUSTOM_CSS = 20_000;

export function metaobjectHandleForVideo(videoId: string): string {
  return `sv-video-${videoId}`;
}
