/**
 * Storefront loader (plan, C3), budget 10 KB gzipped: finds widgets printed
 * by the Liquid blocks, applies show rules, hydrates them, shows the pop-up,
 * and lazy-loads the player on the first tap.
 */
import { matchesRules, normalizeRules, normalizeWidgetSettings, stringsFor, type PageContext, type WidgetIsland } from "@sv/shared";
import { hydrate } from "./hydrate";
import { popupHtml } from "./markup";
import { pauseAllPreviews } from "./media";
import { track } from "./events";

/** What Liquid prints; strings are filled in here. */
export type RawIsland = Omit<WidgetIsland, "strings"> & {
  locale: string;
  translations?: Record<string, Record<string, string>>;
  page?: PageContext;
  playerUrl: string;
};

type PlayerModule = typeof import("./player");

let playerPromise: Promise<PlayerModule> | null = null;

function loadPlayer(url: string): Promise<PlayerModule> {
  playerPromise ??= new Promise((resolve, reject) => {
    const w = window as unknown as { __svPlayer?: PlayerModule };
    if (w.__svPlayer) return resolve(w.__svPlayer);
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => (w.__svPlayer ? resolve(w.__svPlayer) : reject(new Error("player")));
    s.onerror = () => {
      playerPromise = null;
      reject(new Error("player"));
    };
    document.head.appendChild(s);
  });
  return playerPromise;
}

export function readIsland(el: Element): (WidgetIsland & { page?: PageContext; playerUrl: string }) | null {
  const script = el.querySelector("script[data-sv-island]");
  if (!script?.textContent) return null;
  try {
    const raw = JSON.parse(script.textContent) as RawIsland;
    return {
      ...raw,
      settings: normalizeWidgetSettings(raw.settings, raw.type),
      rules: normalizeRules(raw.rules),
      strings: stringsFor(raw.locale || "en", raw.translations),
    };
  } catch {
    return null;
  }
}

function open(island: WidgetIsland & { playerUrl: string }, i: number, from: HTMLElement) {
  pauseAllPreviews();
  void loadPlayer(island.playerUrl).then((m) => m.openPlayer(island, i, { returnFocus: from }));
}

function initWidget(el: HTMLElement) {
  const island = readIsland(el);
  if (!island || island.videos.length === 0) {
    el.classList.add("sv-hidden");
    return null;
  }
  if (island.page && !matchesRules(island.rules, island.page)) {
    el.classList.add("sv-hidden");
    return null;
  }
  hydrate(el, island, (w, i, from) => open(island, i, from));
  return island;
}

const KEY = "sv-popup-closed";

function store(kind: "session" | "never"): Storage | null {
  try {
    return kind === "never" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function initPopup(host: HTMLElement) {
  if (document.querySelector(".sv-popup")) return;
  const island = readIsland(host);
  if (!island || island.videos.length === 0) return;
  if (island.page && !matchesRules(island.rules, island.page)) return;
  const p = island.settings.popup;
  const closedKey = `${KEY}:${island.handle}`;
  if (store("never")?.getItem(closedKey) === "never" || store("session")?.getItem(closedKey)) return;

  setTimeout(() => {
    const wrap = document.createElement("div");
    wrap.innerHTML = popupHtml(island);
    const el = wrap.firstElementChild as HTMLElement | null;
    if (!el) return;
    document.body.appendChild(el);
    hydrate(el, island, (w, i, from) => open(island, i, from));
    el.querySelector(".sv-popup-x")?.addEventListener("click", (e) => {
      e.stopPropagation();
      el.remove();
      if (p.reappear === "never") store("never")?.setItem(closedKey, "never");
      if (p.reappear === "session") store("session")?.setItem(closedKey, "1");
    });
  }, p.delayMs);
}

/** ?sv_video=<id> opens that video (share links, feature 25). */
function openDeepLink(islands: Array<WidgetIsland & { playerUrl: string }>) {
  const id = new URLSearchParams(window.location.search).get("sv_video");
  if (!id) return;
  for (const island of islands) {
    const i = island.videos.findIndex((v) => v.id === id);
    if (i >= 0) {
      open(island, i, document.body);
      return;
    }
  }
}

export function boot() {
  const islands: Array<WidgetIsland & { playerUrl: string }> = [];
  document.querySelectorAll<HTMLElement>("[data-sv-widget]").forEach((el) => {
    const island = initWidget(el);
    if (island) islands.push(island);
  });
  const popupHost = document.querySelector<HTMLElement>("[data-sv-popup]");
  if (popupHost) {
    initPopup(popupHost);
    const pi = readIsland(popupHost);
    if (pi) islands.push(pi);
  }
  openDeepLink(islands);
  // Lazy-loaded embeds in page builders (feature 38).
  if (document.querySelector("[data-sv-embed]")) {
    const cfg = document.querySelector("[data-sv-embed-src]")?.getAttribute("data-sv-embed-src");
    if (cfg) {
      const s = document.createElement("script");
      s.src = cfg;
      s.async = true;
      document.head.appendChild(s);
    }
  }
}

const w = window as unknown as { __svLoaded?: boolean; SV?: unknown };
if (!w.__svLoaded) {
  w.__svLoaded = true;
  // Public API (plan, later: feature 74): open the player from theme code.
  w.SV = { track, rescan: boot };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Theme editor: re-init blocks when merchants add or change them.
  document.addEventListener("shopify:section:load", boot);
  document.addEventListener("shopify:block:select", boot);
}
