import { beforeEach, describe, expect, it } from "vitest";
import { attributeOrders, cleanupEvents, rollup } from "../src/analytics/stats";
import { dashboard } from "../src/analytics/read";
import { makeShop, prisma, resetDb } from "../../../test/db";

const mins = (m: number) => new Date(Date.now() - m * 60_000);

describe("analytics", () => {
  beforeEach(resetDb);

  it("attributes a test order to the right video and shows it on the dashboard", async () => {
    const shop = await makeShop("a.myshopify.com", "growth");
    const widget = await prisma.widget.create({ data: { shopId: shop.id, name: "Home", type: "carousel", handle: "home" } });
    const v1 = await prisma.video.create({ data: { shopId: shop.id, title: "Tee video" } });
    const v2 = await prisma.video.create({ data: { shopId: shop.id, title: "Other" } });
    const base = { shopId: shop.id, clientId: "c1", widgetId: widget.id };
    await prisma.event.createMany({
      data: [
        { ...base, type: "sv_impression", ts: mins(30) },
        { ...base, type: "sv_view", videoId: v1.id, ts: mins(29) },
        { ...base, type: "sv_watch", videoId: v1.id, value: 12000, ts: mins(28) },
        { ...base, type: "sv_complete", videoId: v1.id, ts: mins(28) },
        { ...base, type: "sv_view", videoId: v2.id, ts: mins(27) },
        { ...base, type: "sv_click", videoId: v1.id, productId: "9", ts: mins(26) },
        { ...base, type: "sv_add_to_cart", videoId: v1.id, productId: "9", value: 25, ts: mins(25) },
        // Another shopper adds the same product but never buys.
        { ...base, clientId: "c2", type: "sv_add_to_cart", videoId: v2.id, productId: "9", value: 25, ts: mins(24) },
        {
          shopId: shop.id,
          clientId: "c1",
          type: "checkout_completed",
          value: 40,
          ts: mins(5),
          payload: { orderId: "1001", currency: "USD", lines: [{ productId: "9", quantity: 1, price: 25 }, { productId: "10", quantity: 1, price: 15 }] },
        },
      ],
    });

    await attributeOrders();
    await attributeOrders(); // idempotent
    const rows = await prisma.attributedOrder.findMany({ orderBy: [{ kind: "asc" }, { videoId: "asc" }] });
    const direct = rows.filter((r) => r.kind === "direct");
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ videoId: v1.id, productId: "9", orderId: "1001" });
    expect(Number(direct[0].value)).toBe(25);
    const influenced = rows.filter((r) => r.kind === "influenced");
    expect(influenced.map((r) => r.videoId).sort()).toEqual([v1.id, v2.id].sort());

    await rollup();
    await rollup(); // idempotent
    const d = await dashboard(shop.id, 7);
    expect(d.totals).toMatchObject({ impressions: 1, views: 2, watchMs: 12000, completions: 1, clicks: 1, carts: 2, orders: 1, revenue: 25 });
    expect(d.attributed.direct).toEqual({ orders: 1, revenue: 25 });
    expect(d.attributed.influenced).toEqual({ orders: 1, revenue: 40 });
    expect(d.byWidget[0]).toMatchObject({ name: "Home", views: 2 });
    expect(d.byVideo[0]).toMatchObject({ title: "Tee video", revenue: 25, views: 1 });
    expect(d.topProducts[0]).toMatchObject({ productId: "9", orders: 1, revenue: 25, carts: 2 });
  });

  it("does not attribute outside 7 days or across shoppers", async () => {
    const shop = await makeShop("a.myshopify.com");
    await prisma.event.createMany({
      data: [
        { shopId: shop.id, clientId: "c1", type: "sv_add_to_cart", videoId: "v", productId: "9", ts: mins(8 * 24 * 60) },
        { shopId: shop.id, clientId: "c2", type: "sv_view", videoId: "v", ts: mins(10) },
        { shopId: shop.id, clientId: "c1", type: "checkout_completed", ts: mins(1), payload: { orderId: "1", currency: "USD", lines: [{ productId: "9", quantity: 1, price: 5 }] } },
      ],
    });
    await attributeOrders(24 * 30);
    expect(await prisma.attributedOrder.count()).toBe(0);
  });

  it("drops events after 14 days", async () => {
    const shop = await makeShop("a.myshopify.com");
    await prisma.event.createMany({
      data: [
        { shopId: shop.id, clientId: "c", type: "sv_view", ts: mins(15 * 24 * 60) },
        { shopId: shop.id, clientId: "c", type: "sv_view", ts: mins(1) },
      ],
    });
    await cleanupEvents();
    expect(await prisma.event.count()).toBe(1);
  });
});
