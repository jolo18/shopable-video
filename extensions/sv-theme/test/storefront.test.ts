// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettingsFor, formatMoney, normalizeRules, stringsFor, type WidgetIsland } from "@sv/shared";
import { esc, popupHtml, widgetHtml } from "../src/markup";
import { findVariant } from "../src/sheet";
import { addToCart, dawnAdapter, genericAdapter, horizonAdapter, pickAdapter } from "../src/cart";
import { playerSource, previewSource } from "../src/media";
import { islandFromStorefront } from "../src/embed";

function island(over: Partial<WidgetIsland> = {}): WidgetIsland {
  return {
    id: "w1",
    handle: "home",
    type: "carousel",
    settings: defaultSettingsFor("carousel"),
    rules: normalizeRules({}),
    moneyFormat: "${{amount}}",
    strings: stringsFor("en"),
    branding: true,
    cartMode: "drawer",
    root: "/",
    videos: [
      {
        id: "v1",
        title: "Look <1>",
        caption: "",
        poster: "https://cdn.shopify.com/p.jpg",
        sources: [
          { url: "https://cdn.shopify.com/hd.mp4", type: "video/mp4", width: 1080, height: 1920 },
          { url: "https://cdn.shopify.com/sd.mp4", type: "video/mp4", width: 480, height: 854 },
          { url: "https://cdn.shopify.com/v.m3u8", type: "application/x-mpegURL", width: 1080, height: 1920 },
        ],
        products: [
          { id: "9", handle: "tee", title: "Tee", url: "/products/tee", price: 2500, compareAtPrice: 3000, image: null, available: true, variantId: "91", hasOptions: false },
        ],
      },
    ],
    ...over,
  };
}

describe("markup", () => {
  it("escapes text and renders each layout", () => {
    const html = widgetHtml(island());
    expect(html).toContain("Look &#60;1&#62;");
    expect(html).not.toContain("<1>");
    expect(html).toContain("sv-arrow");
    expect(html).toContain("$25.00");
    expect(html).toContain("sv-badge");
    for (const type of ["stories", "grid", "featured"] as const) {
      expect(widgetHtml(island({ type, settings: defaultSettingsFor(type) }))).toContain(`sv-w--${type}`);
    }
    expect(popupHtml(island({ type: "popup" }))).toContain("sv-popup--bottom-right");
    expect(esc(`"'&`)).toBe("&#34;&#39;&#38;");
  });

  it("formats money formats", () => {
    expect(formatMoney(123456, "${{amount}}")).toBe("$1,234.56");
    expect(formatMoney(123456, "{{amount_with_comma_separator}} €")).toBe("1.234,56 €");
    expect(formatMoney(123456, "¥{{amount_no_decimals}}")).toBe("¥1,235");
  });
});

describe("renditions", () => {
  it("previews use the smallest MP4; slow networks get it in the player too", () => {
    const v = island().videos[0];
    expect(previewSource(v)?.width).toBe(480);
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    expect(playerSource(v)?.width).toBe(480);
    Object.defineProperty(navigator, "connection", { value: { effectiveType: "4g" }, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    expect(playerSource(v)?.width).toBe(1080);
  });
});

describe("variant picker", () => {
  const product = {
    id: 1,
    title: "Tee",
    handle: "tee",
    options: ["Size", "Color"],
    variants: [
      { id: 1, title: "S / Red", options: ["S", "Red"], available: false, price: 1000, compare_at_price: null },
      { id: 2, title: "M / Red", options: ["M", "Red"], available: true, price: 1200, compare_at_price: null },
    ],
  };
  it("matches chosen options, else first available", () => {
    expect(findVariant(product, ["S", "Red"])?.id).toBe(1);
    expect(findVariant(product, [])?.id).toBe(2);
  });
});

describe("cart adapters", () => {
  let calls: Array<{ url: string; body?: unknown }>;
  beforeEach(() => {
    calls = [];
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("cart/add.js")) return new Response(JSON.stringify({ items: [{ id: 91 }], sections: { "cart-drawer": "<div></div>" } }));
      if (url.endsWith("cart.js")) return new Response(JSON.stringify({ item_count: 3 }));
      return new Response("{}", { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses Dawn's cart drawer when present", async () => {
    const drawer = document.createElement("cart-drawer") as HTMLElement & Record<string, unknown>;
    const rendered: unknown[] = [];
    drawer.getSectionsToRender = () => [{ id: "cart-drawer" }, { id: "cart-icon-bubble" }];
    drawer.renderContents = (s: unknown) => rendered.push(s);
    document.body.appendChild(drawer);
    expect(pickAdapter()).toBe(dawnAdapter);
    const res = await addToCart("91", 1, "/", "drawer");
    expect(res).toEqual({ itemCount: 3, openedDrawer: true });
    expect((calls[0].body as { sections: string[] }).sections).toEqual(["cart-drawer", "cart-icon-bubble"]);
    expect(rendered).toHaveLength(1);
  });

  it("signals Horizon's cart:update", async () => {
    document.body.innerHTML = "<cart-drawer-component></cart-drawer-component>";
    expect(pickAdapter()).toBe(horizonAdapter);
    const seen: CustomEvent[] = [];
    document.addEventListener("cart:update", (e) => seen.push(e as CustomEvent));
    await addToCart("91", 1, "/", "drawer");
    expect(seen[0].detail.data.itemCount).toBe(3);
  });

  it("falls back to updating counts", async () => {
    document.body.innerHTML = `<span data-cart-count>0</span>`;
    expect(pickAdapter()).toBe(genericAdapter);
    await addToCart("91", 2, "/fr/", "drawer");
    expect(calls[0].url).toBe("/fr/cart/add.js");
    expect(document.querySelector("[data-cart-count]")!.textContent).toBe("3");
  });

  it("surfaces add errors", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: 422, description: "Sold out" }), { status: 422 }));
    await expect(addToCart("91", 1, "/", "stay")).rejects.toThrow("Sold out");
  });
});

describe("player", () => {
  it("opens, tracks a view and closes", async () => {
    const events: string[] = [];
    document.addEventListener("sv:event", (e) => events.push((e as CustomEvent).detail.type));
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver ??= class {
      observe() {}
      disconnect() {}
    };
    HTMLMediaElement.prototype.play = async () => {};
    HTMLMediaElement.prototype.pause = () => {};
    const { openPlayer } = await import("../src/player");
    const p = openPlayer(island(), 0, { preview: true });
    expect(document.querySelector(".sv-player")).not.toBeNull();
    expect(document.documentElement.classList.contains("sv-open")).toBe(true);
    expect(events).toContain("sv_view");
    expect(document.querySelector(".sv-pcard .sv-price-was")?.textContent).toBe("$30.00");
    p.close();
    expect(document.querySelector(".sv-player")).toBeNull();
  });
});

describe("embed hydrator", () => {
  it("builds an island from Storefront API data", () => {
    const mo = {
      type: { value: "grid" },
      settings: { value: JSON.stringify({ heading: "Hi" }) },
      rules: { value: "{}" },
      appId: { value: "w9" },
      videos: {
        references: {
          nodes: [
            {
              appId: { value: "v1" },
              title: { value: "A" },
              caption: { value: "" },
              video: { reference: { sources: [{ url: "u.mp4", mimeType: "video/mp4", width: 480, height: 854 }], previewImage: { url: "p.jpg" } } },
              cover: { reference: null },
              products: {
                references: {
                  nodes: [
                    {
                      id: "gid://shopify/Product/9",
                      handle: "tee",
                      title: "Tee",
                      onlineStoreUrl: null,
                      availableForSale: true,
                      featuredImage: null,
                      priceRange: { minVariantPrice: { amount: "25.0" } },
                      compareAtPriceRange: { maxVariantPrice: { amount: "0.0" } },
                      variants: { nodes: [{ id: "gid://shopify/ProductVariant/91", availableForSale: true }] },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };
    const i = islandFromStorefront(mo, "home", { moneyFormat: "${{amount}}", strings: stringsFor("en"), branding: false, cartMode: "drawer", root: "/" });
    expect(i.type).toBe("grid");
    expect(i.settings.heading).toBe("Hi");
    expect(i.videos[0].products[0]).toMatchObject({ id: "9", variantId: "91", price: 2500, url: "/products/tee" });
  });
});
