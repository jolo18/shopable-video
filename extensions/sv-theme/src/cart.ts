/**
 * CartAdapter (plan, C4): adds the line through the theme's Ajax cart, then
 * refreshes the theme's cart drawer and count. Adapters are tried in order:
 * Dawn family, Horizon family, then a generic fallback.
 */

export interface CartResult {
  itemCount: number;
  /** True when a theme drawer opened, so we should close the player */
  openedDrawer: boolean;
}

export interface CartAdapter {
  name: string;
  matches(): boolean;
  add(variantId: string, qty: number, root: string): Promise<CartResult>;
}

/** The add itself failed (sold out, limit reached): show the message. */
export class CartError extends Error {}

async function postAdd(root: string, body: Record<string, unknown>) {
  const res = await fetch(`${root}cart/add.js`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status) {
    throw new CartError(json.description || json.message || "Could not add to cart");
  }
  return json;
}

async function itemCount(root: string): Promise<number> {
  try {
    const cart = await (await fetch(`${root}cart.js`, { headers: { accept: "application/json" } })).json();
    return Number(cart.item_count) || 0;
  } catch {
    return 0;
  }
}

type DawnCart = HTMLElement & {
  getSectionsToRender?: () => Array<{ id: string }>;
  renderContents?: (state: unknown) => void;
};

/** Dawn and themes built on it: <cart-drawer> or <cart-notification>. */
export const dawnAdapter: CartAdapter = {
  name: "dawn",
  matches: () => {
    const el = document.querySelector<DawnCart>("cart-drawer, cart-notification");
    return Boolean(el?.getSectionsToRender && el.renderContents);
  },
  async add(variantId, qty, root) {
    const cart = document.querySelector<DawnCart>("cart-drawer, cart-notification")!;
    const sections = cart.getSectionsToRender!().map((s) => s.id);
    const res = await postAdd(root, {
      items: [{ id: Number(variantId), quantity: qty }],
      sections,
      sections_url: window.location.pathname,
    });
    try {
      cart.classList.remove("is-empty");
      const line = res.items?.[0] ?? res;
      cart.renderContents!({ ...line, sections: res.sections });
      return { itemCount: await itemCount(root), openedDrawer: true };
    } catch {
      return refreshCounts(root, res);
    }
  },
};

/** Horizon family: listens for cart:update and has <cart-drawer-component>. */
export const horizonAdapter: CartAdapter = {
  name: "horizon",
  matches: () => Boolean(document.querySelector("cart-drawer-component, cart-items-component")),
  async add(variantId, qty, root) {
    const sectionIds = [...document.querySelectorAll<HTMLElement>("cart-items-component[data-section-id], [data-cart-section-id]")]
      .map((e) => e.dataset.sectionId || e.dataset.cartSectionId || "")
      .filter(Boolean);
    const res = await postAdd(root, {
      items: [{ id: Number(variantId), quantity: qty }],
      ...(sectionIds.length ? { sections: sectionIds.join(","), sections_url: window.location.pathname } : {}),
    });
    const count = await itemCount(root);
    document.dispatchEvent(
      new CustomEvent("cart:update", {
        bubbles: true,
        detail: { resource: res, sourceId: "sv", data: { source: "sv", itemCount: count, sections: res.sections ?? {} } },
      }),
    );
    const drawer = document.querySelector<HTMLElement & { open?: () => void; showDialog?: () => void }>("cart-drawer-component");
    const opener = drawer?.open ?? drawer?.showDialog;
    if (drawer && opener) {
      opener.call(drawer);
      return { itemCount: count, openedDrawer: true };
    }
    return { itemCount: count, openedDrawer: false };
  },
};

const COUNT_SELECTORS = [
  "[data-cart-count]",
  ".cart-count-bubble span[aria-hidden]",
  ".cart-count",
  ".cart__count",
  ".site-header__cart-count span",
  "#CartCount span",
  ".header__cart-count",
];

/** Anything else: add, update visible counts and fire the common events. */
export const genericAdapter: CartAdapter = {
  name: "generic",
  matches: () => true,
  async add(variantId, qty, root) {
    const res = await postAdd(root, { items: [{ id: Number(variantId), quantity: qty }] });
    return refreshCounts(root, res);
  },
};

async function refreshCounts(root: string, res: unknown): Promise<CartResult> {
    const count = await itemCount(root);
    for (const sel of COUNT_SELECTORS) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        el.textContent = String(count);
        el.removeAttribute("hidden");
      });
    }
    for (const name of ["cart:refresh", "cart:updated", "ajaxProduct:added", "theme:cart:change"]) {
      document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: { cart: res, itemCount: count } }));
    }
    return { itemCount: count, openedDrawer: false };
}

export const ADAPTERS: CartAdapter[] = [dawnAdapter, horizonAdapter, genericAdapter];

export function pickAdapter(): CartAdapter {
  return ADAPTERS.find((a) => {
    try {
      return a.matches();
    } catch {
      return false;
    }
  })!;
}

export async function addToCart(variantId: string, qty: number, root: string, mode: "drawer" | "cart_page" | "stay") {
  if (mode !== "drawer") {
    const res = await genericAdapter.add(variantId, qty, root);
    if (mode === "cart_page") window.location.href = `${root}cart`;
    return res;
  }
  return pickAdapter().add(variantId, qty, root);
}

export async function buyNow(variantId: string, qty: number, root: string) {
  await postAdd(root, { items: [{ id: Number(variantId), quantity: qty }] });
  window.location.href = `${root}checkout`;
}
