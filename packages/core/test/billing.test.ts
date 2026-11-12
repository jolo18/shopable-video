import { beforeEach, describe, expect, it } from "vitest";
import { FakeShopify } from "../src/testing";
import { applySubscriptionWebhook, planFromSubscriptions, syncPlan } from "../src/billing";
import { claim } from "../src/jobs/queue";
import { makeShop, prisma, resetDb } from "../../../test/db";

describe("billing", () => {
  beforeEach(resetDb);

  it("maps subscriptions to plans", () => {
    expect(planFromSubscriptions([])).toBe("free");
    expect(planFromSubscriptions([{ name: "Growth", status: "ACTIVE" }])).toBe("growth");
    expect(planFromSubscriptions([{ name: "Growth", status: "CANCELLED" }])).toBe("free");
    expect(planFromSubscriptions([{ name: "Mystery", status: "ACTIVE" }])).toBe("free");
  });

  it("syncs from Shopify and republishes on change", async () => {
    const fake = new FakeShopify();
    const shop = await makeShop(fake.shop, "free");
    fake.activeSubscriptions = [{ id: "gid://shopify/AppSubscription/1", name: "Pro", status: "ACTIVE", test: true }];
    expect(await syncPlan(shop.id, fake.client())).toBe("pro");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("pro");
    expect(await claim("t", 5, ["shop.publish_all"])).toHaveLength(1);
    // No change, no new job.
    await syncPlan(shop.id, fake.client());
    expect(await claim("t", 5, ["shop.publish_all"])).toHaveLength(0);
  });

  it("applies the subscription webhook", async () => {
    const shop = await makeShop("w.myshopify.com", "free");
    await applySubscriptionWebhook("w.myshopify.com", { app_subscription: { name: "Starter", status: "ACTIVE" } });
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("starter");
    // Cancelling another plan does not touch the current one.
    await applySubscriptionWebhook("w.myshopify.com", { app_subscription: { name: "Pro", status: "CANCELLED" } });
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("starter");
    await applySubscriptionWebhook("w.myshopify.com", { app_subscription: { name: "Starter", status: "CANCELLED" } });
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })).plan).toBe("free");
  });
});
