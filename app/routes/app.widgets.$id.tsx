import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  PAGE_TYPES,
  WIDGET_TYPES,
  WIDGET_TYPE_LABELS,
  MAX_VIDEOS_PER_WIDGET,
  normalizeRules,
  normalizeWidgetSettings,
  type ShowRules,
  type WidgetSettings,
  type WidgetType,
} from "@sv/shared";
import {
  assignedCollections,
  deleteWidget,
  getWidget,
  listVideos,
  normalizeShopSettings,
  onWidgetDeleted,
  publishWidgetAndPlacements,
  setWidgetVideos,
  updateWidget,
} from "@sv/core";
import prisma from "../db.server";
import { adminContext, jsonError } from "../lib/context.server";
import { productSummaries, publisherFor } from "../lib/publishing.server";
import { parseWidgetForm } from "../lib/widget-form";
import { WidgetPreview, type PreviewVideo } from "../components/WidgetPreview";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const widget = await getWidget(ctx.shop.id, params.id!);
  if (!widget) throw new Response("Not found", { status: 404 });
  const library = await listVideos(ctx.shop.id, { status: "ready", pageSize: 100 });
  const all = new Map(library.videos.map((v) => [v.id, v]));
  for (const wv of widget.videos) all.set(wv.videoId, { ...wv.video, products: [], _count: { widgets: 0 } });
  const productIds = [...new Set(library.videos.flatMap((v) => v.products.map((p) => p.productId)))];
  const products = new Map((await productSummaries(ctx, productIds)).map((p) => [p.id, p]));

  const videos: PreviewVideo[] = [...all.values()].map((v) => {
    const libraryEntry = library.videos.find((l) => l.id === v.id);
    return {
      id: v.id,
      title: v.title,
      caption: v.caption,
      status: v.status,
      poster: v.coverUrl ?? v.posterUrl ?? null,
      sources: ((v.sources as Array<{ url: string; mimeType: string; width: number; height: number }>) ?? []).map((s) => ({
        url: s.url,
        type: s.mimeType,
        width: s.width,
        height: s.height,
      })),
      products: (libraryEntry?.products ?? [])
        .map((p) => products.get(p.productId))
        .filter((p): p is NonNullable<typeof p> => Boolean(p)),
    };
  });
  const settings = normalizeShopSettings(ctx.shop.settings);
  return {
    widget: {
      id: widget.id,
      name: widget.name,
      type: widget.type as WidgetType,
      handle: widget.handle,
      status: widget.status,
      dirty: widget.dirty,
      settings: normalizeWidgetSettings(widget.settings, widget.type as WidgetType),
      rules: normalizeRules(widget.rules),
      assignedCollections: assignedCollections(widget.rules),
      videoIds: widget.videos.map((v) => v.videoId),
      isSitePopup: settings.popupWidgetId === widget.id,
    },
    videos,
    shopDomain: ctx.session.shop,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const id = params.id!;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const w = await deleteWidget(ctx.shop.id, id);
    if (w) await onWidgetDeleted(publisherFor(ctx), ctx.shop.id, w);
    return ctx.redirect("/app/widgets");
  }
  if (intent !== "save" && intent !== "publish") return jsonError("Unknown action");

  const before = await getWidget(ctx.shop.id, id);
  if (!before) return jsonError("Widget not found", 404);
  const parsed = parseWidgetForm(form);
  try {
    await updateWidget(ctx.shop.id, id, {
      name: parsed.name,
      type: parsed.type,
      settings: parsed.settings,
      rules: parsed.rules,
      assignedCollections: parsed.assignedCollections,
    });
    await setWidgetVideos(ctx.shop.id, id, parsed.videoIds);
  } catch (err) {
    return jsonError((err as Error).message);
  }

  // Site-wide pop-up (app embed) points at one popup widget.
  const settings = (ctx.shop.settings ?? {}) as Record<string, unknown>;
  const wantPopup = parsed.type === "popup" && form.get("sitePopup") === "on";
  const isPopup = settings.popupWidgetId === id;
  if (wantPopup !== isPopup) {
    await prisma.shop.update({
      where: { id: ctx.shop.id },
      data: { settings: { ...settings, popupWidgetId: wantPopup ? id : null } },
    });
  }

  if (intent === "publish") {
    const pub = publisherFor(ctx);
    await publishWidgetAndPlacements(pub, ctx.shop.id, id, assignedCollections(before.rules));
    if (wantPopup !== isPopup) await pub.publishConfig();
    return { ok: true, published: true };
  }
  return { ok: true, saved: true };
};

type Picked = { id: string; title: string };

function useLiveForm(onChange: (f: FormData) => void) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    // Polaris web components fire native input/change events; read the
    // whole form each time so the preview matches what Save would send.
    const handler = () => setTimeout(() => onChange(new FormData(form)), 0);
    form.addEventListener("input", handler);
    form.addEventListener("change", handler);
    return () => {
      form.removeEventListener("input", handler);
      form.removeEventListener("change", handler);
    };
  }, [onChange]);
  return ref;
}

const BOOLS = [
  "s.style.showVideoTitle",
  "s.style.showProductCard",
  "s.carousel.arrows",
  "s.carousel.dots",
  "s.carousel.autoRotate",
  "s.preview.autoplay",
  "s.preview.hoverPlay",
  "s.player.autoAdvance",
  "s.player.showProgress",
  "s.player.startMuted",
];

export default function WidgetEditor() {
  const { widget, videos } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const [type, setType] = useState<WidgetType>(widget.type);
  const [settings, setSettings] = useState<WidgetSettings>(widget.settings);
  const [rules, setRules] = useState<ShowRules>(widget.rules);
  const [videoIds, setVideoIds] = useState<string[]>(widget.videoIds);
  const [incProducts, setIncProducts] = useState<Picked[]>(widget.rules.includeProducts.map((id) => ({ id: `gid://shopify/Product/${id}`, title: `Product ${id}` })));
  const [excProducts, setExcProducts] = useState<Picked[]>(widget.rules.excludeProducts.map((id) => ({ id: `gid://shopify/Product/${id}`, title: `Product ${id}` })));
  const [incCollections, setIncCollections] = useState<Picked[]>(widget.rules.includeCollections.map((id) => ({ id: `gid://shopify/Collection/${id}`, title: `Collection ${id}` })));
  const [excCollections, setExcCollections] = useState<Picked[]>(widget.rules.excludeCollections.map((id) => ({ id: `gid://shopify/Collection/${id}`, title: `Collection ${id}` })));
  const [assigned, setAssigned] = useState<Picked[]>(widget.assignedCollections.map((id) => ({ id, title: id.split("/").pop()! })));
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [adding, setAdding] = useState(false);
  const intentRef = useRef<HTMLInputElement>(null);
  const setIntent = (v: string) => {
    if (intentRef.current) intentRef.current.value = v;
  };

  const onForm = useCallback((f: FormData) => {
    const p = parseWidgetForm(f);
    setType(p.type);
    setSettings(p.settings);
    setRules(p.rules);
  }, []);
  const formRef = useLiveForm(onForm);

  const byId = new Map(videos.map((v) => [v.id, v]));
  const selected = videoIds.map((id) => byId.get(id)).filter((v): v is PreviewVideo => Boolean(v));
  const available = videos.filter((v) => v.status === "ready" && !videoIds.includes(v.id));

  function move(i: number, dir: -1 | 1) {
    const next = [...videoIds];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setVideoIds(next);
  }

  async function pick(kind: "product" | "collection", current: Picked[], set: (p: Picked[]) => void) {
    const res = await shopify.resourcePicker({
      type: kind,
      multiple: true,
      action: "select",
      selectionIds: current.map((c) => ({ id: c.id })),
    });
    if (res) set(res.map((r: { id: string; title: string }) => ({ id: r.id, title: r.title })));
  }

  const ids = (list: Picked[]) => list.map((p) => p.id).join(",");
  const s = settings;
  const submitting = nav.state === "submitting";

  return (
    <s-page heading={widget.name} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/widgets">
        Widgets
      </s-link>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" ref={intentRef} defaultValue="save" />
        <input type="hidden" name="__bools" value={BOOLS.join(",")} />
        <input type="hidden" name="videoIds" value={videoIds.join(",")} />
        <input type="hidden" name="r.includeProducts" value={ids(incProducts)} />
        <input type="hidden" name="r.excludeProducts" value={ids(excProducts)} />
        <input type="hidden" name="r.includeCollections" value={ids(incCollections)} />
        <input type="hidden" name="r.excludeCollections" value={ids(excCollections)} />
        <input type="hidden" name="assignedCollections" value={ids(assigned)} />

        <s-grid gridTemplateColumns="@container (inline-size > 900px) 3fr 2fr, 1fr" gap="base">
          <s-grid-item>
            <s-stack gap="base">
              <s-section heading="Widget">
                <s-stack gap="base">
                  <s-text-field name="name" label="Name" defaultValue={widget.name} />
                  <s-select name="type" label="Layout" value={type}>
                    {WIDGET_TYPES.map((t) => (
                      <s-option key={t} value={t}>
                        {WIDGET_TYPE_LABELS[t]}
                      </s-option>
                    ))}
                  </s-select>
                  <s-text-field name="s.heading" label="Heading" defaultValue={s.heading} maxLength={120} />
                  <s-paragraph>
                    Theme block id: <code>{widget.handle}</code>. Paste it into the &quot;Shoppable videos&quot; block in the theme editor.
                  </s-paragraph>
                </s-stack>
              </s-section>

              <s-section heading={`Videos (${videoIds.length}/${MAX_VIDEOS_PER_WIDGET})`}>
                <s-stack gap="small-200">
                  {selected.map((v, i) => (
                    <s-stack key={v.id} direction="inline" gap="small-200" alignItems="center">
                      <s-thumbnail src={v.poster ?? undefined} alt={v.title} size="small" />
                      <s-text>{v.title || "Untitled"}</s-text>
                      {v.status !== "ready" && <s-badge tone="warning">{v.status}</s-badge>}
                      <s-button variant="tertiary" accessibilityLabel="Move up" onClick={() => move(i, -1)}>
                        ↑
                      </s-button>
                      <s-button variant="tertiary" accessibilityLabel="Move down" onClick={() => move(i, 1)}>
                        ↓
                      </s-button>
                      <s-button variant="tertiary" tone="critical" onClick={() => setVideoIds(videoIds.filter((x) => x !== v.id))}>
                        Remove
                      </s-button>
                    </s-stack>
                  ))}
                  {!adding ? (
                    <s-button onClick={() => setAdding(true)} disabled={videoIds.length >= MAX_VIDEOS_PER_WIDGET}>
                      Add videos
                    </s-button>
                  ) : (
                    <s-box padding="base" borderWidth="base" borderRadius="base">
                      <s-stack gap="small-200">
                        {available.length === 0 && <s-text>No more ready videos in the library.</s-text>}
                        {available.map((v) => (
                          <s-stack key={v.id} direction="inline" gap="small-200" alignItems="center">
                            <s-thumbnail src={v.poster ?? undefined} alt={v.title} size="small" />
                            <s-text>{v.title || "Untitled"}</s-text>
                            <s-button variant="tertiary" onClick={() => setVideoIds([...videoIds, v.id].slice(0, MAX_VIDEOS_PER_WIDGET))}>
                              Add
                            </s-button>
                          </s-stack>
                        ))}
                        <s-button variant="tertiary" onClick={() => setAdding(false)}>
                          Done
                        </s-button>
                      </s-stack>
                    </s-box>
                  )}
                </s-stack>
              </s-section>

              <s-section heading="Style">
                <s-stack gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-color-field name="s.style.accentColor" label="Accent" defaultValue={s.style.accentColor} />
                    <s-color-field name="s.style.textColor" label="Text" defaultValue={s.style.textColor} />
                    <s-text-field name="s.style.backgroundColor" label="Background" defaultValue={s.style.backgroundColor} details="A color, or transparent" />
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-number-field name="s.style.cardRadius" label="Corner radius (px)" defaultValue={String(s.style.cardRadius)} min={0} max={999} />
                    <s-number-field name="s.style.gap" label="Spacing (px)" defaultValue={String(s.style.gap)} min={0} max={64} />
                    <s-number-field name="s.style.headingSize" label="Heading size (px)" defaultValue={String(s.style.headingSize)} min={12} max={64} />
                  </s-stack>
                  <s-text-field name="s.style.fontFamily" label="Font" defaultValue={s.style.fontFamily} details="inherit uses your theme's font" />
                  <s-checkbox name="s.style.showVideoTitle" value="on" label="Show video titles" defaultChecked={s.style.showVideoTitle} />
                  <s-checkbox name="s.style.showProductCard" value="on" label="Show a product card under each video" defaultChecked={s.style.showProductCard} />
                </s-stack>
              </s-section>

              <s-section heading="Layout per device">
                <s-stack direction="inline" gap="base">
                  <s-number-field name="s.layout.desktop.columns" label="Desktop columns" defaultValue={String(s.layout.desktop.columns)} min={1} max={8} />
                  <s-number-field name="s.layout.desktop.cardWidth" label="Desktop card width (px)" defaultValue={String(s.layout.desktop.cardWidth)} min={48} max={600} />
                  <s-number-field name="s.layout.mobile.columns" label="Mobile columns" defaultValue={String(s.layout.mobile.columns)} min={1} max={8} />
                  <s-number-field name="s.layout.mobile.cardWidth" label="Mobile card width (px)" defaultValue={String(s.layout.mobile.cardWidth)} min={48} max={600} />
                </s-stack>
              </s-section>

              <s-section heading="Carousel" {...(type !== "carousel" ? { hidden: true } : {})}>
                <s-stack gap="base">
                  <s-checkbox name="s.carousel.arrows" value="on" label="Arrows" defaultChecked={s.carousel.arrows} />
                  <s-checkbox name="s.carousel.dots" value="on" label="Dots" defaultChecked={s.carousel.dots} />
                  <s-checkbox name="s.carousel.autoRotate" value="on" label="Auto-rotate" defaultChecked={s.carousel.autoRotate} />
                  <s-number-field name="s.carousel.intervalMs" label="Rotate every (ms)" defaultValue={String(s.carousel.intervalMs)} min={2000} max={30000} step={500} />
                </s-stack>
              </s-section>

              <s-section heading="Pop-up" {...(type !== "popup" ? { hidden: true } : {})}>
                <s-stack gap="base">
                  <s-checkbox name="sitePopup" value="on" label="Show as the site-wide pop-up (needs the app embed on)" defaultChecked={widget.isSitePopup} />
                  <s-select name="s.popup.corner" label="Corner" value={s.popup.corner}>
                    <s-option value="bottom-right">Bottom right</s-option>
                    <s-option value="bottom-left">Bottom left</s-option>
                  </s-select>
                  <s-select name="s.popup.shape" label="Shape" value={s.popup.shape}>
                    <s-option value="portrait">Portrait</s-option>
                    <s-option value="rounded">Rounded square</s-option>
                    <s-option value="circle">Circle</s-option>
                  </s-select>
                  <s-number-field name="s.popup.size" label="Size (px)" defaultValue={String(s.popup.size)} min={64} max={240} />
                  <s-number-field name="s.popup.delayMs" label="Delay after page load (ms)" defaultValue={String(s.popup.delayMs)} min={0} max={60000} step={500} />
                  <s-select name="s.popup.reappear" label="After a shopper closes it" value={s.popup.reappear}>
                    <s-option value="session">Hide for the visit</s-option>
                    <s-option value="never">Hide for good</s-option>
                    <s-option value="always">Show again on the next page</s-option>
                  </s-select>
                </s-stack>
              </s-section>

              <s-section heading="Playback">
                <s-stack gap="base">
                  <s-checkbox name="s.preview.autoplay" value="on" label="Muted autoplay previews" defaultChecked={s.preview.autoplay} />
                  <s-checkbox name="s.preview.hoverPlay" value="on" label="On desktop, play previews on hover only" defaultChecked={s.preview.hoverPlay} />
                  <s-checkbox name="s.player.autoAdvance" value="on" label="Go to the next video when one ends" defaultChecked={s.player.autoAdvance} />
                  <s-checkbox name="s.player.showProgress" value="on" label="Progress bar" defaultChecked={s.player.showProgress} />
                  <s-checkbox name="s.player.startMuted" value="on" label="Start the player muted" defaultChecked={s.player.startMuted} />
                </s-stack>
              </s-section>

              <s-section heading="Buttons">
                <s-stack direction="inline" gap="base">
                  <s-select name="s.buttons.primary" label="Main button" value={s.buttons.primary}>
                    <s-option value="add_to_cart">Add to cart</s-option>
                    <s-option value="buy_now">Buy now</s-option>
                    <s-option value="view_product">View product</s-option>
                  </s-select>
                  <s-select name="s.buttons.secondary" label="Second button" value={s.buttons.secondary}>
                    <s-option value="none">None</s-option>
                    <s-option value="add_to_cart">Add to cart</s-option>
                    <s-option value="buy_now">Buy now</s-option>
                    <s-option value="view_product">View product</s-option>
                  </s-select>
                </s-stack>
              </s-section>

              <s-section heading="Where it shows">
                <s-stack gap="base">
                  <s-paragraph>Leave everything empty to show on every page where the block or pop-up is placed.</s-paragraph>
                  <s-stack direction="inline" gap="base">
                    {PAGE_TYPES.map((p) => (
                      <s-checkbox key={p} name="r.pageTypes" value={p} label={p} defaultChecked={rules.pageTypes.includes(p)} />
                    ))}
                  </s-stack>
                  <PickedList label="Only these products" items={incProducts} onPick={() => pick("product", incProducts, setIncProducts)} onClear={() => setIncProducts([])} />
                  <PickedList label="Never these products" items={excProducts} onPick={() => pick("product", excProducts, setExcProducts)} onClear={() => setExcProducts([])} />
                  <PickedList label="Only these collections" items={incCollections} onPick={() => pick("collection", incCollections, setIncCollections)} onClear={() => setIncCollections([])} />
                  <PickedList label="Never these collections" items={excCollections} onPick={() => pick("collection", excCollections, setExcCollections)} onClear={() => setExcCollections([])} />
                </s-stack>
              </s-section>

              <s-section heading="Collection pages">
                <PickedList
                  label="Show this widget on these collections' pages (with the Collection videos block)"
                  items={assigned}
                  onPick={() => pick("collection", assigned, setAssigned)}
                  onClear={() => setAssigned([])}
                />
              </s-section>

              <s-stack direction="inline" gap="base">
                <s-button type="submit" onClick={() => setIntent("save")} {...(submitting ? { loading: true } : {})}>
                  Save draft
                </s-button>
                <s-button type="submit" onClick={() => setIntent("publish")} variant="primary" {...(submitting ? { loading: true } : {})}>
                  Publish
                </s-button>
                <s-button type="submit" onClick={() => setIntent("delete")} tone="critical" variant="tertiary">
                  Delete widget
                </s-button>
              </s-stack>
            </s-stack>
          </s-grid-item>

          <s-grid-item>
            <s-section heading="Live preview">
              <s-stack direction="inline" gap="small-200">
                <s-button variant={device === "mobile" ? "primary" : "secondary"} onClick={() => setDevice("mobile")}>
                  Phone
                </s-button>
                <s-button variant={device === "desktop" ? "primary" : "secondary"} onClick={() => setDevice("desktop")}>
                  Desktop
                </s-button>
              </s-stack>
              <WidgetPreview id={widget.id} handle={widget.handle} type={type} settings={settings} rules={rules} videos={selected} device={device} />
            </s-section>
          </s-grid-item>
        </s-grid>
      </Form>
    </s-page>
  );
}

function PickedList(props: { label: string; items: Picked[]; onPick: () => void; onClear: () => void }) {
  return (
    <s-stack gap="small-200">
      <s-text>{props.label}</s-text>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {props.items.length ? props.items.map((i) => <s-badge key={i.id}>{i.title}</s-badge>) : <s-text tone="neutral">None</s-text>}
        <s-button variant="tertiary" onClick={props.onPick}>
          Choose
        </s-button>
        {props.items.length > 0 && (
          <s-button variant="tertiary" onClick={props.onClear}>
            Clear
          </s-button>
        )}
      </s-stack>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
