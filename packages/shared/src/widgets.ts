/**
 * Widget types and settings (features 28-35, 45-52, 56, 18).
 * Settings are stored in Postgres, published as JSON on the sv_widget
 * metaobject and read by the storefront bundle. Always pass stored or
 * user-submitted settings through normalizeWidgetSettings.
 */

export const WIDGET_TYPES = [
  "carousel",
  "stories",
  "grid",
  "featured",
  "popup",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  carousel: "Carousel",
  stories: "Stories",
  grid: "Grid",
  featured: "Featured video",
  popup: "Floating pop-up",
};

/** Liquid loops return 50 entries without pagination (plan, build rules). */
export const MAX_VIDEOS_PER_WIDGET = 50;

export const BUTTON_ACTIONS = ["add_to_cart", "buy_now", "view_product"] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export const POPUP_CORNERS = ["bottom-right", "bottom-left"] as const;
export const POPUP_SHAPES = ["circle", "rounded", "portrait"] as const;
export const POPUP_REAPPEAR = ["always", "session", "never"] as const;

export interface DeviceLayout {
  /** Grid columns, or visible cards for carousel */
  columns: number;
  /** Card width in px for carousel and stories */
  cardWidth: number;
}

export interface WidgetSettings {
  heading: string;
  style: {
    accentColor: string;
    textColor: string;
    backgroundColor: string;
    /** px */
    cardRadius: number;
    /** px */
    gap: number;
    /** "inherit" uses the theme font */
    fontFamily: string;
    /** px */
    headingSize: number;
    showVideoTitle: boolean;
    /** Small product card under each video tile */
    showProductCard: boolean;
  };
  layout: {
    desktop: DeviceLayout;
    mobile: DeviceLayout;
  };
  carousel: {
    arrows: boolean;
    dots: boolean;
    autoRotate: boolean;
    /** ms between slides */
    intervalMs: number;
  };
  popup: {
    corner: (typeof POPUP_CORNERS)[number];
    shape: (typeof POPUP_SHAPES)[number];
    /** px */
    size: number;
    /** ms after page load */
    delayMs: number;
    /** After the shopper closes it */
    reappear: (typeof POPUP_REAPPEAR)[number];
  };
  preview: {
    /** Muted autoplay of the smallest rendition when on screen */
    autoplay: boolean;
    /** Desktop: play on hover instead of on scroll */
    hoverPlay: boolean;
  };
  player: {
    autoAdvance: boolean;
    showProgress: boolean;
    startMuted: boolean;
  };
  buttons: {
    primary: ButtonAction;
    secondary: ButtonAction | "none";
  };
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  heading: "",
  style: {
    accentColor: "#111111",
    textColor: "#111111",
    backgroundColor: "transparent",
    cardRadius: 12,
    gap: 12,
    fontFamily: "inherit",
    headingSize: 24,
    showVideoTitle: false,
    showProductCard: true,
  },
  layout: {
    desktop: { columns: 5, cardWidth: 220 },
    mobile: { columns: 2, cardWidth: 150 },
  },
  carousel: { arrows: true, dots: false, autoRotate: false, intervalMs: 5000 },
  popup: {
    corner: "bottom-right",
    shape: "portrait",
    size: 120,
    delayMs: 2000,
    reappear: "session",
  },
  preview: { autoplay: true, hoverPlay: false },
  player: { autoAdvance: true, showProgress: true, startMuted: true },
  buttons: { primary: "add_to_cart", secondary: "view_product" },
};

/** Per-type tweaks applied on top of the defaults when a widget is created. */
export function defaultSettingsFor(type: WidgetType): WidgetSettings {
  const s = structuredClone(DEFAULT_WIDGET_SETTINGS);
  if (type === "stories") {
    s.style.cardRadius = 999;
    s.style.showProductCard = false;
    s.layout.desktop.cardWidth = 88;
    s.layout.mobile.cardWidth = 72;
  }
  if (type === "grid") {
    s.layout.desktop.columns = 4;
    s.layout.mobile.columns = 2;
  }
  if (type === "featured") {
    s.layout.desktop.columns = 1;
    s.layout.mobile.columns = 1;
  }
  return s;
}

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|transparent|rgba?\(\s*[\d.\s,%]+\))$/;
// Font names only: letters, digits, spaces, quotes, commas and hyphens.
const FONT_RE = /^[\w\s"',-]{1,80}$/;

function clamp(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v: unknown, dflt: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "on") return true;
  if (v === "false" || v === "off") return false;
  return dflt;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt;
}

function color(v: unknown, dflt: string): string {
  return typeof v === "string" && COLOR_RE.test(v.trim()) ? v.trim() : dflt;
}

function text(v: unknown, max: number, dflt: string): string {
  return typeof v === "string" ? v.slice(0, max) : dflt;
}

type Loose = Record<string, unknown>;
function obj(v: unknown): Loose {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {};
}

/**
 * Fills defaults and clamps every value, so the output is always safe to
 * publish and to interpolate into CSS.
 */
export function normalizeWidgetSettings(
  input: unknown,
  type: WidgetType = "carousel",
): WidgetSettings {
  const d = defaultSettingsFor(type);
  const i = obj(input);
  const st = obj(i.style);
  const ly = obj(i.layout);
  const ca = obj(i.carousel);
  const po = obj(i.popup);
  const pr = obj(i.preview);
  const pl = obj(i.player);
  const bt = obj(i.buttons);

  const device = (v: unknown, dd: DeviceLayout): DeviceLayout => {
    const o = obj(v);
    return {
      columns: clamp(o.columns, 1, 8, dd.columns),
      cardWidth: clamp(o.cardWidth, 48, 600, dd.cardWidth),
    };
  };

  const font = text(st.fontFamily, 80, d.style.fontFamily);

  return {
    heading: text(i.heading, 120, d.heading),
    style: {
      accentColor: color(st.accentColor, d.style.accentColor),
      textColor: color(st.textColor, d.style.textColor),
      backgroundColor: color(st.backgroundColor, d.style.backgroundColor),
      cardRadius: clamp(st.cardRadius, 0, 999, d.style.cardRadius),
      gap: clamp(st.gap, 0, 64, d.style.gap),
      fontFamily: FONT_RE.test(font) ? font : d.style.fontFamily,
      headingSize: clamp(st.headingSize, 12, 64, d.style.headingSize),
      showVideoTitle: bool(st.showVideoTitle, d.style.showVideoTitle),
      showProductCard: bool(st.showProductCard, d.style.showProductCard),
    },
    layout: {
      desktop: device(ly.desktop, d.layout.desktop),
      mobile: device(ly.mobile, d.layout.mobile),
    },
    carousel: {
      arrows: bool(ca.arrows, d.carousel.arrows),
      dots: bool(ca.dots, d.carousel.dots),
      autoRotate: bool(ca.autoRotate, d.carousel.autoRotate),
      intervalMs: clamp(ca.intervalMs, 2000, 30000, d.carousel.intervalMs),
    },
    popup: {
      corner: oneOf(po.corner, POPUP_CORNERS, d.popup.corner),
      shape: oneOf(po.shape, POPUP_SHAPES, d.popup.shape),
      size: clamp(po.size, 64, 240, d.popup.size),
      delayMs: clamp(po.delayMs, 0, 60000, d.popup.delayMs),
      reappear: oneOf(po.reappear, POPUP_REAPPEAR, d.popup.reappear),
    },
    preview: {
      autoplay: bool(pr.autoplay, d.preview.autoplay),
      hoverPlay: bool(pr.hoverPlay, d.preview.hoverPlay),
    },
    player: {
      autoAdvance: bool(pl.autoAdvance, d.player.autoAdvance),
      showProgress: bool(pl.showProgress, d.player.showProgress),
      startMuted: bool(pl.startMuted, d.player.startMuted),
    },
    buttons: {
      primary: oneOf(bt.primary, BUTTON_ACTIONS, d.buttons.primary),
      secondary: oneOf(
        bt.secondary,
        [...BUTTON_ACTIONS, "none"] as const,
        d.buttons.secondary,
      ),
    },
  };
}

export function isWidgetType(v: unknown): v is WidgetType {
  return WIDGET_TYPES.includes(v as WidgetType);
}
