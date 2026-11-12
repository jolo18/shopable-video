import { beforeEach, describe, expect, it } from "vitest";
import { ensureShop, markUninstalled, redactCustomerOrders, redactShop } from "../src/shops";
import { prisma, resetDb } from "../../../test/db";

describe("shops", () => {
  beforeEach(resetDb);

  it("ensureShop is idempotent and clears uninstall", async () => {
    const a = await ensureShop("s.myshopify.com");
    await markUninstalled("s.myshopify.com");
    const b = await ensureShop("s.myshopify.com");
    expect(b.id).toBe(a.id);
    expect(b.uninstalledAt).toBeNull();
  });

  it("shop/redact removes all shop data", async () => {
    const shop = await ensureShop("s.myshopify.com");
    await prisma.video.create({ data: { shopId: shop.id, title: "v" } });
    await prisma.event.create({ data: { shopId: shop.id, ts: new Date(), clientId: "c", type: "sv_view" } });
    await redactShop("s.myshopify.com");
    expect(await prisma.shop.count()).toBe(0);
    expect(await prisma.video.count()).toBe(0);
    expect(await prisma.event.count()).toBe(0);
  });

  it("customers/redact removes named orders", async () => {
    const shop = await ensureShop("s.myshopify.com");
    const common = { shopId: shop.id, clientId: "c", videoId: "v", kind: "direct", value: 10, currency: "USD", orderedAt: new Date() };
    await prisma.attributedOrder.createMany({ data: [{ ...common, orderId: "1" }, { ...common, orderId: "2" }] });
    await prisma.event.create({
      data: { shopId: shop.id, ts: new Date(), clientId: "c", type: "checkout_completed", payload: { orderId: "1" } },
    });
    await redactCustomerOrders("s.myshopify.com", [1]);
    expect((await prisma.attributedOrder.findMany()).map((o) => o.orderId)).toEqual(["2"]);
    expect(await prisma.event.count()).toBe(0);
  });
});
