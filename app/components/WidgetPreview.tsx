/**
 * Live preview in the widget editor. Renders with the storefront's own
 * markup, CSS and behaviour, inside a shadow root so admin styles don't leak.
 */
import { useEffect, useRef } from "react";
import {
  stringsFor,
  type IslandSource,
  type ShowRules,
  type WidgetIsland,
  type WidgetSettings,
  type WidgetType,
} from "@sv/shared";
import svCss from "../../extensions/sv-theme/assets/sv.css?raw";
import { popupHtml, widgetHtml } from "../../extensions/sv-theme/src/markup";
import { hydrate } from "../../extensions/sv-theme/src/hydrate";

export interface PreviewVideo {
  id: string;
  title: string;
  caption: string;
  status: string;
  poster: string | null;
  sources: IslandSource[];
  products: Array<{
    id: string;
    title: string;
    handle: string;
    imageUrl: string | null;
    price: number;
    compareAtPrice: number | null;
    hasOptions: boolean;
    variantId: string | null;
  }>;
}

interface Props {
  id: string;
  handle: string;
  type: WidgetType;
  settings: WidgetSettings;
  rules: ShowRules;
  videos: PreviewVideo[];
  device: "mobile" | "desktop";
}

export function toIsland(p: Omit<Props, "device">): WidgetIsland {
  return {
    id: p.id,
    handle: p.handle,
    type: p.type,
    settings: p.settings,
    rules: p.rules,
    moneyFormat: "${{amount}}",
    strings: stringsFor("en"),
    branding: false,
    cartMode: "stay",
    root: "/",
    videos: p.videos.map((v) => ({
      id: v.id,
      title: v.title,
      caption: v.caption,
      poster: v.poster,
      sources: v.sources,
      products: v.products.map((pr) => ({
        id: pr.id.split("/").pop()!,
        handle: pr.handle,
        title: pr.title,
        url: "#",
        price: pr.price,
        compareAtPrice: pr.compareAtPrice,
        image: pr.imageUrl,
        available: true,
        variantId: pr.variantId?.split("/").pop() ?? null,
        hasOptions: pr.hasOptions,
      })),
    })),
  };
}

const PREVIEW_CSS = `
:host{display:block}
.frame{margin-top:12px;border:1px solid #ddd;border-radius:12px;overflow:hidden;background:#fff;position:relative;min-height:240px;padding:12px;container-type:inline-size}
.frame.mobile{width:375px;max-width:100%}
.frame.desktop{width:100%}
.frame .sv-popup{position:absolute}
.empty{font:14px system-ui;color:#666;padding:24px;text-align:center}
`;

export function WidgetPreview(props: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const island = toIsland(props);
    const inner =
      island.videos.length === 0
        ? `<div class="empty">Add videos to see the preview.</div>`
        : island.type === "popup"
          ? popupHtml(island)
          : widgetHtml(island);
    // Desktop widths: force the desktop variables, since the preview pane
    // itself is narrow.
    const deviceCss =
      props.device === "desktop"
        ? `.sv-root{--sv-cols:var(--sv-cols-d)!important;--sv-cw:var(--sv-cw-d)!important}`
        : `.sv-root{--sv-cols:var(--sv-cols-m)!important;--sv-cw:var(--sv-cw-m)!important}`;
    root.innerHTML = `<style>${svCss}${PREVIEW_CSS}${deviceCss}</style><div class="frame ${props.device}">${inner}</div>`;
    const widgetEl = root.querySelector<HTMLElement>(".sv-root");
    if (widgetEl) {
      hydrate(widgetEl, island, (w, i) => {
        void import("../../extensions/sv-theme/src/player").then((m) =>
          m.openPlayer(w, i, { mount: root as unknown as HTMLElement, preview: true }),
        );
      });
    }
  }, [props]);

  return <div ref={host} />;
}
