/**
 * Rendition choice by device and connection (feature 48) and the preview
 * manager (features 45, 47): muted previews start on scroll, three at most.
 */
import type { IslandSource, IslandVideo } from "@sv/shared";

interface NetInfo {
  saveData?: boolean;
  effectiveType?: string;
}

function net(): NetInfo {
  return ((navigator as unknown as { connection?: NetInfo }).connection ?? {}) as NetInfo;
}

export function slowNetwork(): boolean {
  const c = net();
  return Boolean(c.saveData) || /(^|-)(2g|3g)$/.test(c.effectiveType ?? "");
}

const mp4s = (v: IslandVideo) =>
  v.sources.filter((s) => s.type === "video/mp4").sort((a, b) => a.width - b.width);

/** Smallest MP4: previews always use it. */
export function previewSource(v: IslandVideo): IslandSource | undefined {
  return mp4s(v)[0];
}

/** Player source: HLS where it plays natively, else an MP4 sized to the screen. */
export function playerSource(v: IslandVideo, video?: HTMLVideoElement): IslandSource | undefined {
  const hls = v.sources.find((s) => /mpegurl/i.test(s.type));
  if (hls && video?.canPlayType("application/vnd.apple.mpegurl")) return hls;
  const list = mp4s(v);
  if (!list.length) return hls;
  if (slowNetwork()) return list[0];
  const want = Math.min(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  return list.find((s) => s.width >= want) ?? list[list.length - 1];
}

const MAX_ACTIVE = 3;
const active = new Set<HTMLVideoElement>();

function stop(video: HTMLVideoElement) {
  video.pause();
  active.delete(video);
}

function start(video: HTMLVideoElement) {
  if (active.has(video)) return;
  if (active.size >= MAX_ACTIVE) {
    const oldest = active.values().next().value;
    if (oldest) stop(oldest);
  }
  active.add(video);
  if (!video.src) video.src = video.dataset.src ?? "";
  void video.play().catch(() => active.delete(video));
}

/** Pauses every preview, e.g. while the full player is open. */
export function pauseAllPreviews() {
  for (const v of [...active]) stop(v);
}

let observer: IntersectionObserver | null = null;

function getObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const video = e.target as HTMLVideoElement;
        if (e.isIntersecting && e.intersectionRatio > 0.6 && !document.documentElement.classList.contains("sv-open")) start(video);
        else stop(video);
      }
    },
    { threshold: [0, 0.6] },
  );
  return observer;
}

/**
 * Adds a muted preview video over a tile's poster. With hoverPlay the
 * preview starts on hover (desktop) instead of on scroll.
 */
export function attachPreview(tile: HTMLElement, v: IslandVideo, hoverPlay: boolean) {
  const src = previewSource(v);
  if (!src || slowNetwork()) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const media = tile.querySelector(".sv-media");
  if (!media) return;
  const video = document.createElement("video");
  video.className = "sv-preview";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.dataset.src = src.url;
  media.appendChild(video);
  const canHover = window.matchMedia?.("(hover: hover)").matches;
  if (hoverPlay && canHover) {
    tile.addEventListener("mouseenter", () => start(video));
    tile.addEventListener("mouseleave", () => stop(video));
  } else {
    getObserver().observe(video);
  }
}
