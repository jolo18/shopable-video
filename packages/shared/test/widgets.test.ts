import { describe, expect, it } from "vitest";
import { defaultSettingsFor, normalizeWidgetSettings } from "../src/widgets";
import { stringsFor } from "../src/translations";
import { entitlementsFor, videosRemaining } from "../src/plans";

describe("widget settings", () => {
  it("fills defaults per type", () => {
    expect(normalizeWidgetSettings({}, "stories")).toEqual(defaultSettingsFor("stories"));
  });

  it("clamps numbers and rejects unsafe CSS values", () => {
    const s = normalizeWidgetSettings({
      style: { cardRadius: 5000, gap: "8", accentColor: "red;}body{display:none", fontFamily: "x;}<script>" },
      layout: { mobile: { columns: 0 } },
      popup: { corner: "top-left" },
      buttons: { primary: "buy_now", secondary: "none" },
    });
    expect(s.style.cardRadius).toBe(999);
    expect(s.style.gap).toBe(8);
    expect(s.style.accentColor).toBe("#111111");
    expect(s.style.fontFamily).toBe("inherit");
    expect(s.layout.mobile.columns).toBe(1);
    expect(s.popup.corner).toBe("bottom-right");
    expect(s.buttons).toEqual({ primary: "buy_now", secondary: "none" });
  });
});

describe("translations", () => {
  it("falls back by language and applies overrides", () => {
    expect(stringsFor("fr-CA").add_to_cart).toBe("Ajouter au panier");
    expect(stringsFor("ja").add_to_cart).toBe("Add to cart");
    expect(stringsFor("en", { en: { add_to_cart: "Grab it" } }).add_to_cart).toBe("Grab it");
  });
});

describe("plans", () => {
  it("defaults unknown plans to free", () => {
    expect(entitlementsFor("bogus").maxVideos).toBe(15);
    expect(videosRemaining(entitlementsFor("free"), 20)).toBe(0);
    expect(videosRemaining(entitlementsFor("pro"), 20)).toBe(Infinity);
  });
});
