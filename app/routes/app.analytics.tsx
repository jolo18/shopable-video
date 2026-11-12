import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { entitlementsFor } from "@sv/shared";
import { dashboard } from "@sv/core";
import { adminContext } from "../lib/context.server";
import { productSummaries } from "../lib/publishing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await adminContext(request);
  if (!entitlementsFor(ctx.shop.plan).analytics) return { locked: true as const };
  const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("days")))
    ? Number(new URL(request.url).searchParams.get("days"))
    : 30;
  const d = await dashboard(ctx.shop.id, days);
  const titles = new Map(
    (await productSummaries(ctx, d.topProducts.map((p) => `gid://shopify/Product/${p.productId}`))).map((p) => [
      p.id.split("/").pop()!,
      p.title,
    ]),
  );
  return {
    locked: false as const,
    days,
    d: { ...d, topProducts: d.topProducts.map((p) => ({ ...p, title: titles.get(p.productId) ?? `Product ${p.productId}` })) },
  };
};

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "–");
const secs = (ms: number, views: number) => (views > 0 ? `${(ms / views / 1000).toFixed(1)}s` : "–");

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();

  if (data.locked) {
    return (
      <s-page heading="Analytics">
        <s-section>
          <s-paragraph>Analytics are on paid plans: views, watch time, add to carts, orders and revenue per widget and video.</s-paragraph>
          <s-button href="/app/plans" variant="primary">
            See plans
          </s-button>
        </s-section>
      </s-page>
    );
  }

  const { d } = data;
  const money = (v: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: d.attributed.currency ?? "USD" }).format(v);
  const t = d.totals;

  return (
    <s-page heading="Analytics">
      <s-section>
        <Form method="get">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-select name="days" label="Period" value={params.get("days") ?? "30"}>
              <s-option value="7">Last 7 days</s-option>
              <s-option value="30">Last 30 days</s-option>
              <s-option value="90">Last 90 days</s-option>
            </s-select>
            <s-button type="submit">Apply</s-button>
          </s-stack>
        </Form>
        <s-paragraph>
          <s-text tone="neutral">
            Counts shoppers who accepted analytics tracking only. Shopify blocks events for shoppers who declined. Updated every few minutes.
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Funnel">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
          <Stat label="Widget impressions" value={t.impressions.toLocaleString()} />
          <Stat label="Video views" value={t.views.toLocaleString()} note={pct(t.views, t.impressions) + " of impressions"} />
          <Stat label="Avg watch time" value={secs(t.watchMs, t.views)} note={pct(t.completions, t.views) + " completed"} />
          <Stat label="Product clicks" value={t.clicks.toLocaleString()} />
          <Stat label="Add to carts" value={t.carts.toLocaleString()} note={pct(t.carts, t.views) + " of views"} />
          <Stat label="Orders (direct)" value={d.attributed.direct.orders.toLocaleString()} note={money(d.attributed.direct.revenue)} />
          <Stat label="Orders (influenced)" value={d.attributed.influenced.orders.toLocaleString()} note={money(d.attributed.influenced.revenue)} />
        </s-grid>
        <s-paragraph>
          <s-text tone="neutral">
            Direct: the shopper added the item to cart from a video and bought it within 7 days. Influenced: the shopper watched a video in the 7 days before ordering.
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Widgets">
        <FunnelTable rows={d.byWidget.map((w) => ({ ...w, key: w.widgetId }))} money={money} />
      </s-section>

      <s-section heading="Top videos">
        <FunnelTable rows={d.byVideo.map((v) => ({ key: v.videoId, name: v.title, ...v }))} money={money} />
      </s-section>

      <s-section heading="Top products">
        {d.topProducts.length === 0 ? (
          <s-paragraph>No add to carts yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Add to carts</s-table-header>
              <s-table-header>Orders (direct)</s-table-header>
              <s-table-header>Revenue (direct)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.topProducts.map((p) => (
                <s-table-row key={p.productId}>
                  <s-table-cell>{p.title}</s-table-cell>
                  <s-table-cell>{p.carts}</s-table-cell>
                  <s-table-cell>{p.orders}</s-table-cell>
                  <s-table-cell>{money(p.revenue)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function Stat(props: { label: string; value: string; note?: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text tone="neutral">{props.label}</s-text>
        <s-heading>{props.value}</s-heading>
        {props.note && <s-text tone="neutral">{props.note}</s-text>}
      </s-stack>
    </s-box>
  );
}

interface FunnelRow {
  key: string;
  name: string;
  impressions: number;
  views: number;
  watchMs: number;
  completions: number;
  clicks: number;
  carts: number;
  orders: number;
  revenue: number;
}

function FunnelTable({ rows, money }: { rows: FunnelRow[]; money: (v: number) => string }) {
  if (rows.length === 0) return <s-paragraph>No data for this period yet.</s-paragraph>;
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header>Name</s-table-header>
        <s-table-header>Impressions</s-table-header>
        <s-table-header>Views</s-table-header>
        <s-table-header>Avg watch</s-table-header>
        <s-table-header>Completion</s-table-header>
        <s-table-header>Clicks</s-table-header>
        <s-table-header>Add to carts</s-table-header>
        <s-table-header>Orders</s-table-header>
        <s-table-header>Revenue</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((r) => (
          <s-table-row key={r.key}>
            <s-table-cell>{r.name}</s-table-cell>
            <s-table-cell>{r.impressions || "–"}</s-table-cell>
            <s-table-cell>{r.views}</s-table-cell>
            <s-table-cell>{secs(r.watchMs, r.views)}</s-table-cell>
            <s-table-cell>{pct(r.completions, r.views)}</s-table-cell>
            <s-table-cell>{r.clicks}</s-table-cell>
            <s-table-cell>{r.carts}</s-table-cell>
            <s-table-cell>{r.orders}</s-table-cell>
            <s-table-cell>{money(r.revenue)}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
