import { describe, expect, it } from "vitest";
import { validateBatch } from "../src/events";

const now = 1_800_000_000_000;
const base = { shop: "a-shop.myshopify.com", clientId: "c1" };

describe("validateBatch", () => {
  it("accepts good events and drops bad ones", () => {
    const r = validateBatch(
      {
        ...base,
        events: [
          { type: "sv_view", ts: now, widgetId: "w1", videoId: "v1" },
          { type: "nope", ts: now },
          { type: "sv_watch", ts: now - 2 * 86_400_000, value: 10 },
          { type: "sv_watch", ts: now, value: 4200 },
        ],
      },
      now,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batch.events.map((e) => e.type)).toEqual(["sv_view", "sv_watch"]);
    expect(r.dropped).toBe(2);
    expect(r.batch.events[0].shop).toBe(base.shop);
  });

  it("rejects bad shops, empty and oversized batches", () => {
    expect(validateBatch({ ...base, shop: "evil.com", events: [{ type: "sv_view", ts: now }] }, now).ok).toBe(false);
    expect(validateBatch({ ...base, events: [] }, now).ok).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ type: "sv_view", ts: now }));
    expect(validateBatch({ ...base, events: many }, now).ok).toBe(false);
  });

  it("requires a valid order on checkout_completed", () => {
    const order = { orderId: "123", currency: "USD", lines: [{ productId: "9", quantity: 1, price: 20 }] };
    const ok = validateBatch({ ...base, events: [{ type: "checkout_completed", ts: now, value: 20, order }] }, now);
    expect(ok.ok && ok.batch.events[0].order?.orderId).toBe("123");
    const bad = validateBatch(
      { ...base, events: [{ type: "checkout_completed", ts: now, order: { ...order, currency: "usd" } }] },
      now,
    );
    expect(bad.ok).toBe(false);
  });

  it("drops events that claim another shop", () => {
    const r = validateBatch({ ...base, events: [{ type: "sv_view", ts: now, shop: "b.myshopify.com" }] }, now);
    expect(r.ok).toBe(false);
  });
});
