/**
 * Show rules by page, product and collection (feature 53).
 * Evaluated in the storefront bundle against what Liquid knows about the
 * current page, and in the admin preview. Product and collection ids are
 * numeric strings (Liquid's product.id), never gids.
 */

export const PAGE_TYPES = [
  "index",
  "product",
  "collection",
  "page",
  "cart",
  "search",
  "blog",
  "article",
  "other",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export interface ShowRules {
  /** Empty = every page type */
  pageTypes: PageType[];
  /** Product pages: only these products. Empty = all */
  includeProducts: string[];
  excludeProducts: string[];
  /** Collection pages, or product pages in these collections. Empty = all */
  includeCollections: string[];
  excludeCollections: string[];
}

export const DEFAULT_RULES: ShowRules = {
  pageTypes: [],
  includeProducts: [],
  excludeProducts: [],
  includeCollections: [],
  excludeCollections: [],
};

export interface PageContext {
  /** Liquid template.name; unknown names count as "other" */
  pageType: string;
  productId?: string;
  /** Current collection on a collection page */
  collectionId?: string;
  /** Collections the current product belongs to */
  productCollectionIds?: string[];
}

/** "gid://shopify/Product/123" -> "123"; numeric strings pass through. */
export function numericId(id: string | number): string {
  const s = String(id);
  const m = s.match(/(\d+)$/);
  return m ? m[1] : s;
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x === "string" || typeof x === "number") {
      const n = numericId(x);
      if (/^\d+$/.test(n)) out.add(n);
    }
    if (out.size >= 250) break;
  }
  return [...out];
}

export function normalizeRules(input: unknown): ShowRules {
  const i =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const pageTypes = Array.isArray(i.pageTypes)
    ? [...new Set(i.pageTypes.filter((p): p is PageType => PAGE_TYPES.includes(p as PageType)))]
    : [];
  return {
    pageTypes,
    includeProducts: ids(i.includeProducts),
    excludeProducts: ids(i.excludeProducts),
    includeCollections: ids(i.includeCollections),
    excludeCollections: ids(i.excludeCollections),
  };
}

function pageTypeOf(name: string): PageType {
  const base = name.split(".")[0] as PageType;
  return PAGE_TYPES.includes(base) ? base : "other";
}

export function matchesRules(rules: ShowRules, ctx: PageContext): boolean {
  const type = pageTypeOf(ctx.pageType);
  if (rules.pageTypes.length && !rules.pageTypes.includes(type)) return false;

  const productId = ctx.productId ? numericId(ctx.productId) : undefined;
  const collections = new Set(
    [
      ...(ctx.productCollectionIds ?? []),
      ...(ctx.collectionId ? [ctx.collectionId] : []),
    ].map(numericId),
  );

  if (productId) {
    if (rules.excludeProducts.includes(productId)) return false;
    if (type === "product" && rules.includeProducts.length) {
      if (!rules.includeProducts.includes(productId)) return false;
    }
  }

  if (rules.excludeCollections.some((c) => collections.has(c))) return false;
  if (
    rules.includeCollections.length &&
    (type === "collection" || type === "product")
  ) {
    if (!rules.includeCollections.some((c) => collections.has(c))) {
      // A product explicitly included still shows outside the collections.
      if (!(productId && rules.includeProducts.includes(productId)))
        return false;
    }
  }
  return true;
}
