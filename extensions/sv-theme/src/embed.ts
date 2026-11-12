/**
 * Embed hydrator (feature 38): for page builders and themes without app
 * blocks. Merchants paste <div data-sv-embed="WIDGET_ID"></div>; this reads
 * the same metaobjects through the Storefront API with the app's public
 * token and renders the widget.
 */
import { normalizeRules, normalizeWidgetSettings, stringsFor, type IslandVideo, type WidgetIsland, type WidgetType } from "@sv/shared";
import { widgetHtml } from "./markup";
import { hydrate } from "./hydrate";
import { pauseAllPreviews } from "./media";

const QUERY = `query svEmbed($handle: MetaobjectHandleInput!) {
  metaobject(handle: $handle) {
    type: field(key: "type") { value }
    settings: field(key: "settings") { value }
    rules: field(key: "rules") { value }
    appId: field(key: "app_id") { value }
    videos: field(key: "videos") { references(first: 50) { nodes { ... on Metaobject {
      appId: field(key: "app_id") { value }
      title: field(key: "title") { value }
      caption: field(key: "caption") { value }
      video: field(key: "video") { reference { ... on Video { sources { url mimeType width height } previewImage { url } } } }
      cover: field(key: "cover") { reference { ... on MediaImage { image { url } } } }
      products: field(key: "products") { references(first: 10) { nodes { ... on Product {
        id handle title onlineStoreUrl availableForSale
        featuredImage { url }
        priceRange { minVariantPrice { amount } }
        compareAtPriceRange { maxVariantPrice { amount } }
        variants(first: 2) { nodes { id availableForSale } }
      } } } }
    } } } }
  }
}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (gid: string) => String(gid).split("/").pop() ?? "";
const cents = (a?: string) => Math.round(Number(a ?? 0) * 100);

export function islandFromStorefront(mo: any, handle: string, base: Omit<WidgetIsland, "id" | "handle" | "type" | "settings" | "rules" | "videos">): WidgetIsland {
  const type = (mo.type?.value ?? "carousel") as WidgetType;
  const parse = (v?: string) => {
    try {
      return v ? JSON.parse(v) : {};
    } catch {
      return {};
    }
  };
  const videos: IslandVideo[] = (mo.videos?.references?.nodes ?? []).map((n: any) => {
    const vid = n.video?.reference ?? {};
    return {
      id: n.appId?.value ?? "",
      title: n.title?.value ?? "",
      caption: n.caption?.value ?? "",
      poster: n.cover?.reference?.image?.url ?? vid.previewImage?.url ?? null,
      sources: (vid.sources ?? []).map((s: any) => ({ url: s.url, type: s.mimeType, width: s.width, height: s.height })),
      products: (n.products?.references?.nodes ?? []).map((p: any) => {
        const variants = p.variants?.nodes ?? [];
        const first = variants.find((v: any) => v.availableForSale) ?? variants[0];
        const price = cents(p.priceRange?.minVariantPrice?.amount);
        const compare = cents(p.compareAtPriceRange?.maxVariantPrice?.amount);
        return {
          id: num(p.id),
          handle: p.handle,
          title: p.title,
          url: p.onlineStoreUrl ?? `${base.root}products/${p.handle}`,
          price,
          compareAtPrice: compare > price ? compare : null,
          image: p.featuredImage?.url ?? null,
          available: Boolean(p.availableForSale),
          variantId: first ? num(first.id) : null,
          hasOptions: variants.length > 1,
        };
      }),
    };
  });
  return {
    ...base,
    id: mo.appId?.value ?? handle,
    handle,
    type,
    settings: normalizeWidgetSettings(parse(mo.settings?.value), type),
    rules: normalizeRules(parse(mo.rules?.value)),
    videos,
  };
}

async function run() {
  const cfgEl = document.querySelector<HTMLElement>("[data-sv-embed-src]");
  if (!cfgEl) return;
  const d = cfgEl.dataset;
  if (!d.svSfToken || !d.svSfType) return;
  let translations = {};
  try {
    translations = JSON.parse(cfgEl.textContent || "{}").translations ?? {};
  } catch {
    /* defaults */
  }
  const root = ((window as any).Shopify?.routes?.root as string) || "/";
  const base = {
    moneyFormat: d.svMoney || "${{amount}}",
    strings: stringsFor(d.svLocale || "en", translations),
    branding: d.svBranding !== "0",
    cartMode: (d.svCart as WidgetIsland["cartMode"]) || "drawer",
    root,
  };
  const els = document.querySelectorAll<HTMLElement>("[data-sv-embed]:not([data-sv-done])");
  for (const el of els) {
    el.dataset.svDone = "1";
    const handle = el.dataset.svEmbed!;
    try {
      const res = await fetch(`${root}api/2026-10/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-shopify-storefront-access-token": d.svSfToken },
        body: JSON.stringify({ query: QUERY, variables: { handle: { type: d.svSfType, handle } } }),
      });
      const json = await res.json();
      const mo = json?.data?.metaobject;
      if (!mo) continue;
      const island = islandFromStorefront(mo, handle, base);
      el.innerHTML = widgetHtml(island);
      const w = el.firstElementChild as HTMLElement;
      hydrate(w, island, (wi, i, from) => {
        pauseAllPreviews();
        const g = window as any;
        const go = () => g.__svPlayer.openPlayer(wi, i, { returnFocus: from });
        if (g.__svPlayer) return go();
        const s = document.createElement("script");
        s.src = d.svPlayer!;
        s.onload = go;
        document.head.appendChild(s);
      });
    } catch {
      /* leave the placeholder empty */
    }
  }
}

void run();
