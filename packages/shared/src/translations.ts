/**
 * Storefront text (feature 55). Defaults ship in English and a few common
 * languages; merchants override any key per locale in the admin, which is
 * published in StorefrontConfig.translations.
 */

export const STRING_KEYS = [
  "add_to_cart",
  "buy_now",
  "view_product",
  "added",
  "sold_out",
  "close",
  "mute",
  "unmute",
  "share",
  "link_copied",
  "shop_now",
  "select_option",
  "powered_by",
  "next",
  "previous",
] as const;
export type StringKey = (typeof STRING_KEYS)[number];
export type Strings = Record<StringKey, string>;

export const DEFAULT_STRINGS: Record<string, Strings> = {
  en: {
    add_to_cart: "Add to cart",
    buy_now: "Buy now",
    view_product: "View product",
    added: "Added",
    sold_out: "Sold out",
    close: "Close",
    mute: "Mute",
    unmute: "Unmute",
    share: "Share",
    link_copied: "Link copied",
    shop_now: "Shop now",
    select_option: "Select an option",
    powered_by: "Powered by shopable-video",
    next: "Next",
    previous: "Previous",
  },
  fr: {
    add_to_cart: "Ajouter au panier",
    buy_now: "Acheter maintenant",
    view_product: "Voir le produit",
    added: "Ajouté",
    sold_out: "Épuisé",
    close: "Fermer",
    mute: "Couper le son",
    unmute: "Activer le son",
    share: "Partager",
    link_copied: "Lien copié",
    shop_now: "Acheter",
    select_option: "Choisir une option",
    powered_by: "Propulsé par shopable-video",
    next: "Suivant",
    previous: "Précédent",
  },
  es: {
    add_to_cart: "Añadir al carrito",
    buy_now: "Comprar ahora",
    view_product: "Ver producto",
    added: "Añadido",
    sold_out: "Agotado",
    close: "Cerrar",
    mute: "Silenciar",
    unmute: "Activar sonido",
    share: "Compartir",
    link_copied: "Enlace copiado",
    shop_now: "Comprar",
    select_option: "Elige una opción",
    powered_by: "Con la tecnología de shopable-video",
    next: "Siguiente",
    previous: "Anterior",
  },
  de: {
    add_to_cart: "In den Warenkorb",
    buy_now: "Jetzt kaufen",
    view_product: "Produkt ansehen",
    added: "Hinzugefügt",
    sold_out: "Ausverkauft",
    close: "Schließen",
    mute: "Stumm",
    unmute: "Ton an",
    share: "Teilen",
    link_copied: "Link kopiert",
    shop_now: "Jetzt shoppen",
    select_option: "Option wählen",
    powered_by: "Bereitgestellt von shopable-video",
    next: "Weiter",
    previous: "Zurück",
  },
};

/**
 * Strings for a storefront locale ("fr-CA" falls back to "fr", then "en"),
 * with merchant overrides on top.
 */
export function stringsFor(
  locale: string,
  overrides: Record<string, Record<string, string>> = {},
): Strings {
  const lang = locale.toLowerCase().split("-")[0];
  const base = { ...DEFAULT_STRINGS.en, ...(DEFAULT_STRINGS[lang] ?? {}) };
  const ov = { ...(overrides[lang] ?? {}), ...(overrides[locale] ?? {}) };
  for (const k of STRING_KEYS) {
    const v = ov[k];
    if (typeof v === "string" && v.trim()) base[k] = v.slice(0, 120);
  }
  return base;
}
