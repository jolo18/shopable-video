/**
 * Full-screen swipe player (features 35, 46): vertical swipe between videos,
 * mute, progress, auto-advance, product cards, product sheet, share.
 * Loaded on the first tap (plan, C3), as its own bundle.
 */
import type { IslandProduct, IslandVideo, WidgetIsland } from "@sv/shared";
import { cssVars, esc, priceHtml, sized, starsHtml } from "./markup";
import { playerSource } from "./media";
import { track } from "./events";
import { openSheet } from "./sheet";
import { addToCart, buyNow } from "./cart";

export interface PlayerOptions {
  /** Where to attach (admin preview passes its shadow root) */
  mount?: HTMLElement;
  /** Admin preview: no real cart calls, no navigation */
  preview?: boolean;
  /** Element to focus when the player closes */
  returnFocus?: HTMLElement | null;
}

let current: { close: () => void } | null = null;

export function openPlayer(w: WidgetIsland, start: number, opts: PlayerOptions = {}) {
  current?.close();
  const mount = opts.mount ?? document.body;
  const s = w.settings;
  const strings = w.strings;
  let muted = s.player.startMuted;

  const el = document.createElement("div");
  el.className = "sv-root sv-player";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", w.videos[start]?.title || strings.shop_now);
  el.setAttribute("style", cssVars(w));
  el.innerHTML =
    (s.player.showProgress ? `<div class="sv-progress"><i></i></div>` : "") +
    `<div class="sv-top">` +
    `<button type="button" class="sv-ib sv-mute" aria-label="${esc(muted ? strings.unmute : strings.mute)}">${muted ? "🔇" : "🔊"}</button>` +
    `<button type="button" class="sv-ib sv-share" aria-label="${esc(strings.share)}">↗</button>` +
    `<button type="button" class="sv-ib sv-close" aria-label="${esc(strings.close)}">×</button>` +
    `</div><div class="sv-feed">${w.videos.map((v, i) => slide(v, i, w)).join("")}</div>`;
  mount.appendChild(el);
  document.documentElement.classList.add("sv-open");

  const feed = el.querySelector<HTMLElement>(".sv-feed")!;
  const bar = el.querySelector<HTMLElement>(".sv-progress>i");
  const slides = [...el.querySelectorAll<HTMLElement>(".sv-slide")];
  const videos = slides.map((sl) => sl.querySelector("video")!);
  const viewed = new Set<number>();
  let active = -1;
  let watchStart = 0;

  function load(i: number) {
    const v = videos[i];
    if (!v || v.src) return;
    const src = playerSource(w.videos[i], v);
    if (src) v.src = src.url;
  }

  function flushWatch() {
    if (active < 0 || !watchStart) return;
    const ms = Date.now() - watchStart;
    watchStart = 0;
    if (ms > 250) track("sv_watch", { widgetId: w.id, videoId: w.videos[active].id, value: ms });
  }

  function activate(i: number) {
    if (i === active || !w.videos[i]) return;
    flushWatch();
    if (active >= 0) videos[active].pause();
    active = i;
    load(i);
    load(i + 1);
    const v = videos[i];
    v.muted = muted;
    v.currentTime = 0;
    void v.play().catch(() => {
      // Autoplay with sound blocked: fall back to muted.
      muted = true;
      v.muted = true;
      syncMute();
      void v.play().catch(() => {});
    });
    watchStart = Date.now();
    el.setAttribute("aria-label", w.videos[i].title || strings.shop_now);
    if (!viewed.has(i)) {
      viewed.add(i);
      track("sv_view", { widgetId: w.id, videoId: w.videos[i].id });
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(slides.indexOf(e.target as HTMLElement));
    },
    { root: feed, threshold: [0.6] },
  );
  slides.forEach((sl) => io.observe(sl));

  videos.forEach((v, i) => {
    v.addEventListener("timeupdate", () => {
      if (i === active && bar && v.duration) bar.style.width = `${(v.currentTime / v.duration) * 100}%`;
    });
    v.addEventListener("ended", () => {
      if (i !== active) return;
      track("sv_complete", { widgetId: w.id, videoId: w.videos[i].id });
      if (s.player.autoAdvance && i + 1 < slides.length) slides[i + 1].scrollIntoView({ behavior: "smooth" });
      else void v.play().catch(() => {});
    });
    v.addEventListener("click", () => (v.paused ? void v.play() : v.pause()));
  });

  const muteBtn = el.querySelector<HTMLButtonElement>(".sv-mute")!;
  function syncMute() {
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", muted ? strings.unmute : strings.mute);
  }
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    if (active >= 0) videos[active].muted = muted;
    syncMute();
  });

  el.querySelector(".sv-share")!.addEventListener("click", () => share(w, active, el, opts.preview));

  const sheetCtx = {
    root: w.root,
    moneyFormat: w.moneyFormat,
    strings,
    cartMode: w.cartMode,
    buttons: s.buttons,
    preview: opts.preview,
    onClick: (p: IslandProduct) => track("sv_click", { widgetId: w.id, videoId: w.videos[active]?.id, productId: p.id }),
    onAdded: (p: IslandProduct, value: number, openedDrawer: boolean) => {
      track("sv_add_to_cart", { widgetId: w.id, videoId: w.videos[active]?.id, productId: p.id, value: value / 100 });
      if (openedDrawer) close();
    },
  };

  feed.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>(".sv-pbtn");
    const card = t.closest<HTMLElement>(".sv-pcard");
    if (!card) return;
    const vi = Number(card.dataset.v);
    const p = w.videos[vi]?.products[Number(card.dataset.p)];
    if (!p) return;
    const action = s.buttons.primary;
    // A quick action from the card when nothing needs choosing.
    if (btn && !p.hasOptions && p.variantId && p.available && !opts.preview) {
      e.stopPropagation();
      if (action === "view_product") {
        track("sv_click", { widgetId: w.id, videoId: w.videos[vi].id, productId: p.id });
        window.location.href = p.url;
        return;
      }
      btn.textContent = "…";
      try {
        if (action === "buy_now") {
          sheetCtx.onAdded(p, p.price, false);
          await buyNow(p.variantId, 1, w.root);
          return;
        }
        const res = await addToCart(p.variantId, 1, w.root, w.cartMode);
        sheetCtx.onAdded(p, p.price, res.openedDrawer);
        btn.textContent = strings.added;
        toast(el, strings.added);
      } catch (err) {
        btn.textContent = buttonText(action, strings);
        toast(el, (err as Error).message);
      }
      return;
    }
    openSheet(el, p, sheetCtx);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      const sheet = el.querySelector(".sv-sheet");
      if (sheet) sheet.remove();
      else close();
    }
    if (e.key === "ArrowDown") slides[Math.min(active + 1, slides.length - 1)]?.scrollIntoView({ behavior: "smooth" });
    if (e.key === "ArrowUp") slides[Math.max(active - 1, 0)]?.scrollIntoView({ behavior: "smooth" });
    if (e.key === "Tab") trapFocus(e, el);
  }
  document.addEventListener("keydown", onKey);

  function close() {
    flushWatch();
    io.disconnect();
    videos.forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
    document.removeEventListener("keydown", onKey);
    el.remove();
    document.documentElement.classList.remove("sv-open");
    current = null;
    opts.returnFocus?.focus?.();
  }
  el.querySelector(".sv-close")!.addEventListener("click", close);
  const onHide = () => {
    if (document.hidden) {
      flushWatch();
      if (active >= 0) videos[active].pause();
    } else if (active >= 0 && el.isConnected) {
      watchStart = Date.now();
      void videos[active].play().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", onHide);

  slides[start]?.scrollIntoView();
  // IntersectionObserver fires async; start right away for a snappy open.
  activate(Math.max(0, Math.min(start, slides.length - 1)));
  el.querySelector<HTMLElement>(".sv-close")!.focus({ preventScroll: true });

  current = { close };
  return { close };
}

function buttonText(a: string, strings: WidgetIsland["strings"]) {
  return a === "buy_now" ? strings.buy_now : a === "view_product" ? strings.view_product : strings.add_to_cart;
}

function slide(v: IslandVideo, i: number, w: WidgetIsland): string {
  const cards = v.products
    .map(
      (p, j) =>
        `<div class="sv-pcard" role="button" tabindex="0" data-v="${i}" data-p="${j}">` +
        (p.image ? `<img src="${esc(sized(p.image, 120))}" alt="" loading="lazy">` : "") +
        `<span class="sv-card-body"><span class="sv-card-t">${esc(p.title)}</span>${priceHtml(p, w.moneyFormat)}${starsHtml(p)}</span>` +
        `<span class="sv-pbtn">${esc(p.available ? buttonText(w.settings.buttons.primary, w.strings) : w.strings.sold_out)}</span></div>`,
    )
    .join("");
  return (
    `<section class="sv-slide" aria-roledescription="slide" aria-label="${i + 1} / ${w.videos.length}">` +
    (v.poster ? `<img class="sv-slide-poster" src="${esc(sized(v.poster, 720))}" alt="">` : "") +
    `<video playsinline webkit-playsinline preload="none" ${v.poster ? `poster="${esc(sized(v.poster, 720))}"` : ""}></video>` +
    `<div class="sv-info">` +
    (v.title ? `<p class="sv-info-t">${esc(v.title)}</p>` : "") +
    (v.caption ? `<p class="sv-info-c">${esc(v.caption)}</p>` : "") +
    (cards ? `<div class="sv-pcards">${cards}</div>` : "") +
    `</div></section>`
  );
}

/** Share link to a single video (feature 25). */
export function shareUrl(w: WidgetIsland, index: number): string {
  const v = w.videos[index];
  const url = new URL(window.location.href);
  url.searchParams.set("sv_video", v?.id ?? "");
  url.hash = "";
  return url.toString();
}

async function share(w: WidgetIsland, index: number, el: HTMLElement, preview?: boolean) {
  const v = w.videos[index];
  if (!v) return;
  const url = shareUrl(w, index);
  track("sv_share", { widgetId: w.id, videoId: v.id });
  if (preview) {
    toast(el, w.strings.link_copied);
    return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title: v.title || document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(el, w.strings.link_copied);
  } catch {
    /* share sheet dismissed */
  }
}

function toast(el: HTMLElement, text: string) {
  el.querySelector(".sv-toast")?.remove();
  const t = document.createElement("div");
  t.className = "sv-toast";
  t.setAttribute("role", "status");
  t.textContent = text;
  el.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function trapFocus(e: KeyboardEvent, el: HTMLElement) {
  const items = [...el.querySelectorAll<HTMLElement>("button,[tabindex='0'],a[href]")].filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const activeEl = (el.getRootNode() as Document | ShadowRoot).activeElement;
  if (e.shiftKey && activeEl === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && activeEl === last) {
    e.preventDefault();
    first.focus();
  }
}

// Storefront bundle: expose for the loader.
if (typeof window !== "undefined") {
  (window as unknown as { __svPlayer?: unknown }).__svPlayer = { openPlayer };
}
