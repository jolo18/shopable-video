import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, matchesRules, normalizeRules } from "../src/rules";

describe("show rules", () => {
  it("shows everywhere by default", () => {
    expect(matchesRules(DEFAULT_RULES, { pageType: "index" })).toBe(true);
    expect(matchesRules(DEFAULT_RULES, { pageType: "product.alt", productId: "1" })).toBe(true);
  });

  it("filters by page type", () => {
    const r = normalizeRules({ pageTypes: ["product", "bogus"] });
    expect(r.pageTypes).toEqual(["product"]);
    expect(matchesRules(r, { pageType: "index" })).toBe(false);
    expect(matchesRules(r, { pageType: "product" })).toBe(true);
  });

  it("includes and excludes products and collections", () => {
    const r = normalizeRules({
      includeProducts: ["gid://shopify/Product/5"],
      excludeCollections: [7],
    });
    expect(r.includeProducts).toEqual(["5"]);
    expect(matchesRules(r, { pageType: "product", productId: "5" })).toBe(true);
    expect(matchesRules(r, { pageType: "product", productId: "6" })).toBe(false);
    expect(matchesRules(r, { pageType: "product", productId: "5", productCollectionIds: ["7"] })).toBe(false);
    expect(matchesRules(r, { pageType: "collection", collectionId: "7" })).toBe(false);
    expect(matchesRules(r, { pageType: "index" })).toBe(true);
  });

  it("limits to collections", () => {
    const r = normalizeRules({ includeCollections: ["3"] });
    expect(matchesRules(r, { pageType: "collection", collectionId: "3" })).toBe(true);
    expect(matchesRules(r, { pageType: "collection", collectionId: "4" })).toBe(false);
    expect(matchesRules(r, { pageType: "product", productId: "1", productCollectionIds: ["3"] })).toBe(true);
  });
});
