/**
 * Brings a widget's server-rendered markup to life: carousel controls,
 * previews, impressions and opening the player.
 */
import type { WidgetIsland } from "@sv/shared";
import { attachPreview } from "./media";
import { track } from "./events";

export type OpenPlayer = (w: WidgetIsland, index: number, from: HTMLElement) => void;

export function hydrate(el: HTMLElement, w: WidgetIsland, open: OpenPlayer) {
  if (el.dataset.svReady === "1") return;
  el.dataset.svReady = "1";
  const s = w.settings;

  el.querySelectorAll<HTMLElement>("[data-sv-i]").forEach((t) => {
    const i = Number(t.dataset.svI);
    const v = w.videos[i];
    if (!v) return;
    if (t.classList.contains("sv-tile") && s.preview.autoplay) attachPreview(t, v, s.preview.hoverPlay);
    t.addEventListener("click", () => open(w, i, t));
  });

  if (w.type === "carousel") carousel(el, w);

  // One impression per widget per page view, when half of it is on screen.
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        track("sv_impression", { widgetId: w.id });
        io.disconnect();
      }
    },
    { threshold: 0.5 },
  );
  io.observe(el);
}

function carousel(el: HTMLElement, w: WidgetIsland) {
  const vp = el.querySelector<HTMLElement>(".sv-viewport");
  const track = el.querySelector<HTMLElement>(".sv-track");
  if (!vp || !track) return;
  const step = () => {
    const tile = track.querySelector<HTMLElement>(".sv-tile");
    return tile ? tile.offsetWidth + w.settings.style.gap : vp.clientWidth;
  };
  const go = (dir: number) => {
    const atEnd = vp.scrollLeft + vp.clientWidth >= vp.scrollWidth - 4;
    if (dir > 0 && atEnd) vp.scrollTo({ left: 0, behavior: "smooth" });
    else vp.scrollBy({ left: dir * step(), behavior: "smooth" });
  };
  el.querySelector(".sv-prev")?.addEventListener("click", () => go(-1));
  el.querySelector(".sv-next")?.addEventListener("click", () => go(1));

  const dots = el.querySelector<HTMLElement>(".sv-dots");
  if (dots) {
    const n = w.videos.length;
    dots.innerHTML = Array.from({ length: n }, (_, i) => `<button type="button" aria-label="${i + 1}"></button>`).join("");
    const buttons = [...dots.children] as HTMLElement[];
    buttons.forEach((b, i) => b.addEventListener("click", () => vp.scrollTo({ left: i * step(), behavior: "smooth" })));
    const mark = () => {
      const i = Math.round(vp.scrollLeft / Math.max(step(), 1));
      buttons.forEach((b, j) => b.toggleAttribute("aria-current", i === j));
    };
    vp.addEventListener("scroll", mark, { passive: true });
    mark();
  }

  const c = w.settings.carousel;
  if (c.autoRotate) {
    let paused = false;
    el.addEventListener("mouseenter", () => (paused = true));
    el.addEventListener("mouseleave", () => (paused = false));
    el.addEventListener("focusin", () => (paused = true));
    setInterval(() => {
      if (!paused && !document.hidden && !document.documentElement.classList.contains("sv-open")) go(1);
    }, c.intervalMs);
  }
}
