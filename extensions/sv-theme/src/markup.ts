/**
 * Widget markup from a data island. The Liquid snippet sv-widget-markup
 * prints the same structure server-side so posters paint before JavaScript;
 * this version serves the admin live preview, the pop-up and the embed
 * hydrator. Keep the two in step (same classes, same order).
 */
import { formatMoney, type IslandProduct, type IslandVideo, type Strings, type WidgetIsland } from "@sv/shared";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function cssVars(w: WidgetIsland): string {
  const s = w.settings;
  const vars: Record<string, string | number> = {
    "--sv-accent": s.style.accentColor,
    "--sv-text": s.style.textColor,
    "--sv-bg": s.style.backgroundColor,
    "--sv-radius": `${s.style.cardRadius}px`,
    "--sv-gap": `${s.style.gap}px`,
    "--sv-font": s.style.fontFamily,
    "--sv-h": `${s.style.headingSize}px`,
    "--sv-cols-d": s.layout.desktop.columns,
    "--sv-cols-m": s.layout.mobile.columns,
    "--sv-cw-d": `${s.layout.desktop.cardWidth}px`,
    "--sv-cw-m": `${s.layout.mobile.cardWidth}px`,
  };
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${esc(v)}`)
    .join(";");
}

/** Shopify CDN images resize with a width parameter. */
export function sized(url: string | null, width: number): string {
  if (!url) return "";
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + `width=${width}`;
}

export function priceHtml(p: IslandProduct, moneyFormat: string): string {
  const now = `<span class="sv-price-now">${esc(formatMoney(p.price, moneyFormat))}</span>`;
  const was =
    p.compareAtPrice && p.compareAtPrice > p.price
      ? ` <s class="sv-price-was">${esc(formatMoney(p.compareAtPrice, moneyFormat))}</s>`
      : "";
  return `<span class="sv-price">${now}${was}</span>`;
}

export function starsHtml(p: IslandProduct): string {
  if (!p.rating || !p.ratingCount) return "";
  const pct = Math.max(0, Math.min(100, (p.rating / 5) * 100));
  return `<span class="sv-stars" role="img" aria-label="${esc(p.rating.toFixed(1))} / 5"><span class="sv-stars-fill" style="width:${pct}%"></span></span><span class="sv-stars-n">(${esc(p.ratingCount)})</span>`;
}

function card(p: IslandProduct, moneyFormat: string): string {
  return (
    `<span class="sv-card">` +
    (p.image ? `<img class="sv-card-img" src="${esc(sized(p.image, 96))}" alt="" loading="lazy" width="40" height="40">` : "") +
    `<span class="sv-card-body"><span class="sv-card-t">${esc(p.title)}</span>${priceHtml(p, moneyFormat)}</span></span>`
  );
}

export function tile(v: IslandVideo, i: number, w: WidgetIsland, width: number): string {
  const s = w.settings.style;
  const product = v.products[0];
  return (
    `<button type="button" class="sv-tile" data-sv-i="${i}" aria-label="${esc(v.title || w.strings.shop_now)}">` +
    `<span class="sv-media">` +
    (v.poster ? `<img class="sv-poster" src="${esc(sized(v.poster, width))}" alt="" loading="${i < 4 ? "eager" : "lazy"}">` : "") +
    `</span>` +
    (s.showVideoTitle && v.title ? `<span class="sv-tile-t">${esc(v.title)}</span>` : "") +
    (s.showProductCard && product && w.type !== "stories" ? card(product, w.moneyFormat) : "") +
    `</button>`
  );
}

export function badge(strings: Strings): string {
  return `<a class="sv-badge" href="https://apps.shopify.com/" target="_blank" rel="nofollow noopener">${esc(strings.powered_by)}</a>`;
}

export function widgetInner(w: WidgetIsland): string {
  const s = w.settings;
  const heading = s.heading ? `<h2 class="sv-heading">${esc(s.heading)}</h2>` : "";
  const videos = w.videos;
  let body = "";
  if (w.type === "featured") {
    const v = videos[0];
    if (v) {
      const p = v.products[0];
      body =
        `<div class="sv-featured">${tile(v, 0, w, 900)}` +
        `<div class="sv-featured-info">` +
        (v.title ? `<h3 class="sv-featured-t">${esc(v.title)}</h3>` : "") +
        (v.caption ? `<p class="sv-featured-c">${esc(v.caption)}</p>` : "") +
        (p ? `${card(p, w.moneyFormat)}<button type="button" class="sv-btn" data-sv-i="0">${esc(w.strings.shop_now)}</button>` : "") +
        `</div></div>`;
    }
  } else if (w.type === "grid") {
    body = `<div class="sv-grid">${videos.map((v, i) => tile(v, i, w, 480)).join("")}</div>`;
  } else {
    // carousel and stories share a scrolling track
    const width = w.type === "stories" ? 200 : 480;
    body =
      `<div class="sv-viewport"><div class="sv-track">${videos.map((v, i) => tile(v, i, w, width)).join("")}</div></div>` +
      (w.type === "carousel" && s.carousel.arrows
        ? `<button type="button" class="sv-arrow sv-prev" aria-label="${esc(w.strings.previous)}">‹</button><button type="button" class="sv-arrow sv-next" aria-label="${esc(w.strings.next)}">›</button>`
        : "") +
      (w.type === "carousel" && s.carousel.dots ? `<div class="sv-dots"></div>` : "");
  }
  return heading + body + (w.branding ? badge(w.strings) : "");
}

/** Whole widget element, for the pop-up and the embed hydrator. */
export function widgetHtml(w: WidgetIsland): string {
  return `<div class="sv-root sv-w sv-w--${esc(w.type)}" data-sv-ready="0" style="${cssVars(w)}">${widgetInner(w)}</div>`;
}

export function popupHtml(w: WidgetIsland): string {
  const p = w.settings.popup;
  const v = w.videos[0];
  if (!v) return "";
  return (
    `<div class="sv-root sv-popup sv-popup--${esc(p.corner)} sv-popup--${esc(p.shape)}" style="${cssVars(w)};--sv-pop:${p.size}px">` +
    `<button type="button" class="sv-popup-x" aria-label="${esc(w.strings.close)}">×</button>` +
    `<button type="button" class="sv-tile" data-sv-i="0" aria-label="${esc(v.title || w.strings.shop_now)}">` +
    `<span class="sv-media">${v.poster ? `<img class="sv-poster" src="${esc(sized(v.poster, 300))}" alt="">` : ""}</span></button>` +
    `</div>`
  );
}
