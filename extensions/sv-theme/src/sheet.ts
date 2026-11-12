/**
 * Product sheet (feature 17): variant picker, price, stars, add to cart,
 * buy now and view product. Product data comes from the theme's own
 * /products/{handle}.js, never from our database (plan, build rules).
 */
import { formatMoney, type ButtonAction, type IslandProduct, type Strings } from "@sv/shared";
import { esc, sized, starsHtml } from "./markup";
import { addToCart, buyNow } from "./cart";

interface ThemeVariant {
  id: number;
  title: string;
  options: string[];
  available: boolean;
  price: number;
  compare_at_price: number | null;
  featured_image?: { src: string } | null;
}

interface ThemeProduct {
  id: number;
  title: string;
  handle: string;
  url?: string;
  featured_image?: string;
  options: Array<{ name: string; values: string[] } | string>;
  variants: ThemeVariant[];
}

const cache = new Map<string, Promise<ThemeProduct>>();

export function loadProduct(root: string, handle: string): Promise<ThemeProduct> {
  let p = cache.get(handle);
  if (!p) {
    p = fetch(`${root}products/${encodeURIComponent(handle)}.js`, { headers: { accept: "application/json" } }).then((r) => {
      if (!r.ok) throw new Error("Product unavailable");
      return r.json();
    });
    cache.set(handle, p);
    p.catch(() => cache.delete(handle));
  }
  return p;
}

export interface SheetContext {
  root: string;
  moneyFormat: string;
  strings: Strings;
  cartMode: "drawer" | "cart_page" | "stay";
  buttons: { primary: ButtonAction; secondary: ButtonAction | "none" };
  onAdded: (product: IslandProduct, value: number, openedDrawer: boolean) => void;
  onClick: (product: IslandProduct) => void;
  preview?: boolean;
}

function optionName(o: ThemeProduct["options"][number]) {
  return typeof o === "string" ? o : o.name;
}

/** Picks the variant for a choice of option values, or the first available. */
export function findVariant(p: ThemeProduct, chosen: string[]): ThemeVariant | undefined {
  const match = chosen.some(Boolean)
    ? p.variants.find((v) => chosen.every((c, i) => !c || v.options[i] === c))
    : undefined;
  return (
    match ??
    p.variants.find((v) => v.available) ??
    p.variants[0]
  );
}

export function openSheet(container: HTMLElement, product: IslandProduct, ctx: SheetContext) {
  container.querySelector(".sv-sheet")?.remove();
  const sheet = document.createElement("div");
  sheet.className = "sv-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", product.title);
  sheet.innerHTML =
    `<div class="sv-sheet-head">${product.image ? `<img src="${esc(sized(product.image, 200))}" alt="">` : ""}` +
    `<div><p class="sv-sheet-t">${esc(product.title)}</p><div class="sv-sheet-price"></div>${starsHtml(product)}</div>` +
    `<button type="button" class="sv-ib sv-sheet-x" style="margin-left:auto;background:#eee;color:#111" aria-label="${esc(ctx.strings.close)}">×</button></div>` +
    `<div class="sv-opts"></div><div class="sv-actions"></div><div class="sv-msg" role="status"></div>` +
    `<a class="sv-link" href="${esc(product.url)}">${esc(ctx.strings.view_product)}</a>`;
  container.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add("sv-on"));
  const close = () => {
    sheet.classList.remove("sv-on");
    setTimeout(() => sheet.remove(), 250);
  };
  sheet.querySelector(".sv-sheet-x")!.addEventListener("click", close);
  ctx.onClick(product);

  const priceEl = sheet.querySelector<HTMLElement>(".sv-sheet-price")!;
  const opts = sheet.querySelector<HTMLElement>(".sv-opts")!;
  const actions = sheet.querySelector<HTMLElement>(".sv-actions")!;
  const msg = sheet.querySelector<HTMLElement>(".sv-msg")!;

  const setPrice = (price: number, compare: number | null) => {
    priceEl.innerHTML =
      `<span class="sv-price"><span class="sv-price-now">${esc(formatMoney(price, ctx.moneyFormat))}</span>` +
      (compare && compare > price ? ` <s class="sv-price-was">${esc(formatMoney(compare, ctx.moneyFormat))}</s>` : "") +
      `</span>`;
  };
  setPrice(product.price, product.compareAtPrice);

  let variantId = product.variantId;
  let price = product.price;
  let available = product.available;

  const buttonLabel = (a: ButtonAction) =>
    a === "add_to_cart" ? ctx.strings.add_to_cart : a === "buy_now" ? ctx.strings.buy_now : ctx.strings.view_product;

  function renderButtons() {
    const list = [ctx.buttons.primary, ...(ctx.buttons.secondary !== "none" ? [ctx.buttons.secondary] : [])];
    actions.innerHTML = list
      .map((a, i) => {
        const off = a !== "view_product" && (!available || !variantId);
        const label = off ? ctx.strings.sold_out : buttonLabel(a);
        return `<button type="button" class="sv-btn${i ? " sv-btn-2" : ""}" data-a="${a}"${off ? " disabled" : ""}>${esc(label)}</button>`;
      })
      .join("");
  }
  renderButtons();

  actions.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-a]");
    if (!btn) return;
    const a = btn.dataset.a as ButtonAction;
    if (a === "view_product") {
      if (!ctx.preview) window.location.href = product.url;
      return;
    }
    if (!variantId) return;
    if (ctx.preview) {
      msg.textContent = ctx.strings.added;
      return;
    }
    btn.disabled = true;
    msg.textContent = "";
    try {
      if (a === "buy_now") {
        ctx.onAdded(product, price, false);
        await buyNow(variantId, 1, ctx.root);
        return;
      }
      const res = await addToCart(variantId, 1, ctx.root, ctx.cartMode);
      ctx.onAdded(product, price, res.openedDrawer);
      msg.textContent = ctx.strings.added;
      btn.textContent = ctx.strings.added;
    } catch (err) {
      msg.textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
    }
  });

  if (!product.hasOptions || ctx.preview) return;

  loadProduct(ctx.root, product.handle)
    .then((p) => {
      const names = p.options.map(optionName);
      if (names.length === 1 && p.variants.length === 1) return;
      const chosen: string[] = (findVariant(p, []) ?? p.variants[0]).options.slice();
      const values = names.map((_, i) => [...new Set(p.variants.map((v) => v.options[i]))]);

      const update = () => {
        const v = findVariant(p, chosen);
        variantId = v ? String(v.id) : null;
        price = v?.price ?? price;
        available = Boolean(v?.available) && v?.options.every((o, i) => o === chosen[i]) === true;
        setPrice(price, v?.compare_at_price ?? null);
        opts.querySelectorAll<HTMLButtonElement>(".sv-chip").forEach((c) => {
          const i = Number(c.dataset.o);
          c.setAttribute("aria-pressed", String(chosen[i] === c.dataset.v));
          const trial = chosen.slice();
          trial[i] = c.dataset.v!;
          const match = p.variants.find((x) => x.options.every((o, j) => o === trial[j]));
          c.toggleAttribute("data-off", !match?.available);
        });
        renderButtons();
      };

      opts.innerHTML = names
        .map(
          (n, i) =>
            `<div class="sv-opt"><span class="sv-opt-n">${esc(n)}</span><div class="sv-chips">` +
            values[i].map((val) => `<button type="button" class="sv-chip" data-o="${i}" data-v="${esc(val)}">${esc(val)}</button>`).join("") +
            `</div></div>`,
        )
        .join("");
      opts.addEventListener("click", (e) => {
        const c = (e.target as HTMLElement).closest<HTMLButtonElement>(".sv-chip");
        if (!c) return;
        chosen[Number(c.dataset.o)] = c.dataset.v!;
        update();
      });
      update();
    })
    .catch(() => {
      msg.textContent = ctx.strings.select_option;
    });
}
