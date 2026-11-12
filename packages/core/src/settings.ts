/**
 * Shop-wide settings stored in shops.settings and published (in part) as the
 * StorefrontConfig app-data metafield.
 */
import { MAX_CUSTOM_CSS } from "@sv/shared";

export interface ShopSettings {
  cartMode: "drawer" | "cart_page" | "stay";
  customCss: string;
  /** locale -> key -> text */
  translations: Record<string, Record<string, string>>;
  /** Widget the app embed shows as a floating pop-up */
  popupWidgetId: string | null;
  /** Setup checklist steps the merchant ticked off by hand */
  onboarding: { embedEnabled?: boolean; blockAdded?: boolean; dismissed?: boolean };
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  cartMode: "drawer",
  customCss: "",
  translations: {},
  popupWidgetId: null,
  onboarding: {},
};

/**
 * Strips what could break out of a <style> tag. Merchant CSS is otherwise
 * trusted (it's their store), and the loader scopes it under .sv-root.
 */
export function sanitizeCss(css: string): string {
  return css
    .slice(0, MAX_CUSTOM_CSS)
    .replace(/<\/?\s*style/gi, "")
    .replace(/<\/?\s*script/gi, "")
    .replace(/@import[^;]*;?/gi, "");
}

export function normalizeShopSettings(input: unknown): ShopSettings {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const translations: ShopSettings["translations"] = {};
  if (i.translations && typeof i.translations === "object") {
    for (const [locale, strings] of Object.entries(i.translations as Record<string, unknown>)) {
      if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(locale) || !strings || typeof strings !== "object") continue;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(strings as Record<string, unknown>)) {
        if (/^[a-z_]{1,40}$/.test(k) && typeof v === "string" && v.trim()) out[k] = v.slice(0, 120);
      }
      if (Object.keys(out).length) translations[locale] = out;
    }
  }
  const ob = (i.onboarding && typeof i.onboarding === "object" ? i.onboarding : {}) as Record<string, unknown>;
  return {
    cartMode: i.cartMode === "cart_page" || i.cartMode === "stay" ? i.cartMode : "drawer",
    customCss: typeof i.customCss === "string" ? sanitizeCss(i.customCss) : "",
    translations,
    popupWidgetId: typeof i.popupWidgetId === "string" && i.popupWidgetId ? i.popupWidgetId : null,
    onboarding: {
      embedEnabled: ob.embedEnabled === true,
      blockAdded: ob.blockAdded === true,
      dismissed: ob.dismissed === true,
    },
  };
}
