import { describe, expect, it } from "vitest";
import { validateBatch } from "@sv/shared";
import { buildBatches, checkoutEvent } from "../src/pixel-core";

describe("pixel", () => {
  it("turns checkout_completed into an event ingest accepts", () => {
    const e = checkoutEvent({
      order: { id: "gid://shopify/OrderIdentity/1001" },
      currencyCode: "EUR",
      totalPrice: { amount: 40 },
      lineItems: [
        { quantity: 2, variant: { id: "gid://shopify/ProductVariant/91", price: { amount: 10 }, product: { id: "gid://shopify/Product/9" } } },
        { quantity: 1, finalLinePrice: { amount: 20 }, variant: { id: "92", product: { id: "10" } } },
      ],
    })!;
    expect(e.order).toEqual({
      orderId: "1001",
      currency: "EUR",
      lines: [
        { productId: "9", variantId: "91", quantity: 2, price: 20 },
        { productId: "10", variantId: "92", quantity: 1, price: 20 },
      ],
    });
    const [batch] = buildBatches("a.myshopify.com", [{ clientId: "c1", event: e }]);
    expect(validateBatch(batch).ok).toBe(true);
  });

  it("splits batches by client and size", () => {
    const ev = { type: "sv_view", ts: Date.now() };
    const pending = [
      ...Array.from({ length: 60 }, () => ({ clientId: "a", event: ev })),
      { clientId: "b", event: ev },
      { clientId: "", event: ev },
    ];
    const batches = buildBatches("s.myshopify.com", pending);
    expect(batches.map((b) => [b.clientId, b.events.length])).toEqual([["a", 50], ["a", 10], ["b", 1]]);
  });
});
