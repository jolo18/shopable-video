import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PLANS, isPlanKey, type PlanKey } from "@sv/shared";
import { setShopPlan, syncPlan, usage } from "@sv/core";
import { adminContext, jsonError } from "../lib/context.server";

const isTest = () => process.env.BILLING_TEST !== "false";
const managedHandle = () => process.env.SHOPIFY_MANAGED_PRICING_HANDLE ?? "";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  const plan = await syncPlan(ctx.shop.id, ctx.client);
  return {
    plan,
    usage: await usage({ id: ctx.shop.id, plan }),
    plans: Object.values(PLANS),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await adminContext(request);
  const form = await request.formData();
  const key = String(form.get("plan"));
  if (!isPlanKey(key)) return jsonError("Unknown plan");

  // Shopify managed pricing: merchants pick plans on Shopify's own page.
  if (managedHandle()) {
    const store = ctx.session.shop.replace(".myshopify.com", "");
    return ctx.redirect(`https://admin.shopify.com/store/${store}/charges/${managedHandle()}/pricing_plans`, {
      target: "_top",
    });
  }

  if (key === "free") {
    const subs = await ctx.billing.check({ isTest: isTest() });
    for (const s of subs.appSubscriptions) {
      await ctx.billing.cancel({ subscriptionId: s.id, isTest: isTest(), prorate: true });
    }
    await setShopPlan(ctx.shop.id, "free");
    return { ok: true };
  }
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  // Throws a redirect to Shopify's approval page.
  return ctx.billing.request({
    plan: PLANS[key as PlanKey].name as never,
    isTest: isTest(),
    returnUrl: `${appUrl}/app/plans`,
  });
};

function priceLabel(price: number) {
  return price === 0 ? "Free" : `${price.toLocaleString("en-US", { style: "currency", currency: "USD" })}/month`;
}

export default function Plans() {
  const { plan, plans, usage } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Plans">
      <s-section>
        <s-paragraph>
          Unlimited views on every plan. Videos are stored in your own Shopify Files.{" "}
          {usage.limit === null ? `${usage.used} videos in your library.` : `${usage.used} of ${usage.limit} videos used.`}
        </s-paragraph>
      </s-section>
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        {plans.map((p) => {
          const e = p.entitlements;
          const current = p.key === plan;
          return (
            <s-section key={p.key} heading={p.name}>
              <s-stack gap="small-200">
                <s-heading>{priceLabel(p.price)}</s-heading>
                {p.trialDays > 0 && <s-text tone="neutral">{p.trialDays}-day free trial</s-text>}
                <s-unordered-list>
                  <s-list-item>{e.maxVideos === null ? "Unlimited videos" : `${e.maxVideos} videos`}</s-list-item>
                  <s-list-item>{e.multiTag ? "Several products per video" : "One product per video"}</s-list-item>
                  <s-list-item>{e.analytics ? "Analytics and attributed revenue" : "No analytics"}</s-list-item>
                  <s-list-item>{e.autoSync ? "Daily Instagram and TikTok sync" : "Manual social import"}</s-list-item>
                  <s-list-item>{e.branding ? "Small \"Powered by\" badge" : "No branding badge"}</s-list-item>
                </s-unordered-list>
                {current ? (
                  <s-badge tone="success">Current plan</s-badge>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="plan" value={p.key} />
                    <s-button type="submit" variant={p.price > 0 ? "primary" : "secondary"}>
                      {p.price === 0 ? "Switch to Free" : `Choose ${p.name}`}
                    </s-button>
                  </Form>
                )}
              </s-stack>
            </s-section>
          );
        })}
      </s-grid>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
