/**
 * The JSON data island one widget block prints (plan, C3 storefront): Liquid
 * builds it from the sv_widget and sv_video metaobjects and the theme's own
 * product objects. The storefront bundle and the admin live preview both
 * render from this shape.
 */
import type { WidgetSettings, WidgetType } from "./widgets";
import type { Strings } from "./translations";
import type { ShowRules } from "./rules";

export interface IslandSource {
  url: string;
  type: string;
  width: number;
  height: number;
}

export interface IslandProduct {
  /** Numeric product id */
  id: string;
  handle: string;
  title: string;
  url: string;
  /** Minor units (cents), as Liquid gives them */
  price: number;
  compareAtPrice: number | null;
  image: string | null;
  available: boolean;
  /** First available variant, for one-tap add to cart */
  variantId: string | null;
  /** More than one variant: open the sheet to choose */
  hasOptions: boolean;
  /** From a review app's standard product.metafields.reviews.* */
  rating?: number;
  ratingCount?: number;
}

export interface IslandVideo {
  /** Our Postgres id, for events */
  id: string;
  title: string;
  caption: string;
  poster: string | null;
  sources: IslandSource[];
  products: IslandProduct[];
}

export interface WidgetIsland {
  /** Our widget id, for events; "product" for the product page block */
  id: string;
  handle: string;
  type: WidgetType;
  settings: WidgetSettings;
  rules: ShowRules;
  videos: IslandVideo[];
  /** Shop currency formatting, e.g. "${{amount}}" */
  moneyFormat: string;
  strings: Strings;
  branding: boolean;
  cartMode: "drawer" | "cart_page" | "stay";
  /** Shopify.routes.root, for locale-prefixed URLs */
  root: string;
}

/** Formats minor units with a Shopify money format string. */
export function formatMoney(cents: number, format = "${{amount}}"): string {
  const value = cents / 100;
  const fixed2 = value.toFixed(2);
  const withSep = (n: string, thousands: string, decimal: string) => {
    const [int, dec] = n.split(".");
    const i = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return dec ? `${i}${decimal}${dec}` : i;
  };
  return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key: string) => {
    switch (key) {
      case "amount_no_decimals":
        return withSep(Math.round(value).toString(), ",", ".");
      case "amount_with_comma_separator":
        return withSep(fixed2, ".", ",");
      case "amount_no_decimals_with_comma_separator":
        return withSep(Math.round(value).toString(), ".", ",");
      case "amount_with_apostrophe_separator":
        return withSep(fixed2, "'", ".");
      default:
        return withSep(fixed2, ",", ".");
    }
  });
}
