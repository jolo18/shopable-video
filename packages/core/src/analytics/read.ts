/**
 * Analytics service (plan, C3): reads rollups and attributed orders for the
 * dashboard (features 61-64).
 */
import { prisma, type Db } from "../db";

export interface Funnel {
  impressions: number;
  views: number;
  watchMs: number;
  completions: number;
  clicks: number;
  carts: number;
  orders: number;
  revenue: number;
}

export interface Dashboard {
  from: string;
  to: string;
  totals: Funnel;
  attributed: { direct: { orders: number; revenue: number }; influenced: { orders: number; revenue: number }; currency: string | null };
  byWidget: Array<Funnel & { widgetId: string; name: string }>;
  byVideo: Array<Funnel & { videoId: string; title: string; poster: string | null }>;
  topProducts: Array<{ productId: string; orders: number; revenue: number; carts: number }>;
  daily: Array<{ day: string; views: number; carts: number; revenue: number }>;
}

type Row = Record<string, bigint | number | string | null | { toString(): string }>;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function funnel(r: Row): Funnel {
  return {
    impressions: n(r.impressions),
    views: n(r.views),
    watchMs: n(r.watch_ms),
    completions: n(r.completions),
    clicks: n(r.clicks),
    carts: n(r.carts),
    orders: n(r.orders),
    revenue: n(r.revenue),
  };
}

export async function dashboard(shopId: string, days = 30, db: Db = prisma): Promise<Dashboard> {
  const to = new Date();
  const from = new Date(to);
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - (days - 1));

  const sums = `SUM(impressions) impressions, SUM(views) views, SUM(watch_ms) watch_ms, SUM(completions) completions,
    SUM(clicks) clicks, SUM(carts) carts, SUM(orders) orders, SUM(revenue) revenue`;

  const [totals] = await db.$queryRawUnsafe<Row[]>(
    `SELECT ${sums} FROM stats_daily WHERE shop_id = $1::uuid AND day >= $2::date`,
    shopId,
    from,
  );

  const widgetRows = await db.$queryRawUnsafe<Row[]>(
    `SELECT s.widget_id, COALESCE(w.name, 'Product and collection blocks') AS name, ${sums.replace(/SUM\((\w+)\)/g, "SUM(s.$1)")}
     FROM stats_daily s LEFT JOIN widgets w ON w.id::text = s.widget_id
     WHERE s.shop_id = $1::uuid AND s.day >= $2::date AND s.widget_id <> ''
     GROUP BY s.widget_id, w.name ORDER BY SUM(s.views) DESC LIMIT 50`,
    shopId,
    from,
  );

  const videoRows = await db.$queryRawUnsafe<Row[]>(
    `SELECT s.video_id, COALESCE(v.title, 'Deleted video') AS title, COALESCE(v.cover_url, v.poster_url) AS poster,
       ${sums.replace(/SUM\((\w+)\)/g, "SUM(s.$1)")}
     FROM stats_daily s LEFT JOIN videos v ON v.id::text = s.video_id
     WHERE s.shop_id = $1::uuid AND s.day >= $2::date AND s.video_id <> ''
     GROUP BY s.video_id, v.title, v.cover_url, v.poster_url
     ORDER BY SUM(s.revenue) DESC, SUM(s.views) DESC LIMIT 50`,
    shopId,
    from,
  );

  const attributed = await db.$queryRawUnsafe<Row[]>(
    `SELECT kind, COUNT(DISTINCT order_id) orders, SUM(value) revenue, MIN(currency) currency
     FROM (
       SELECT DISTINCT ON (order_id, kind, product_id, CASE WHEN kind = 'influenced' THEN '' ELSE video_id END)
         order_id, kind, value, currency
       FROM attributed_orders WHERE shop_id = $1::uuid AND ordered_at >= $2
     ) t GROUP BY kind`,
    shopId,
    from,
  );
  const att = (k: string) => attributed.find((a) => a.kind === k);

  const topProducts = await db.$queryRawUnsafe<Row[]>(
    `SELECT product_id, SUM(orders) orders, SUM(revenue) revenue, SUM(carts) carts FROM (
       SELECT product_id, COUNT(DISTINCT order_id) orders, SUM(value) revenue, 0 carts
       FROM attributed_orders WHERE shop_id = $1::uuid AND kind = 'direct' AND ordered_at >= $2 GROUP BY product_id
       UNION ALL
       SELECT product_id, 0, 0, COUNT(*) FROM events
       WHERE shop_id = $1::uuid AND type = 'sv_add_to_cart' AND product_id IS NOT NULL AND ts >= $2 GROUP BY product_id
     ) t GROUP BY product_id ORDER BY SUM(revenue) DESC, SUM(carts) DESC LIMIT 10`,
    shopId,
    from,
  );

  const daily = await db.$queryRawUnsafe<Row[]>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(views) views, SUM(carts) carts, SUM(revenue) revenue
     FROM stats_daily WHERE shop_id = $1::uuid AND day >= $2::date GROUP BY day ORDER BY day`,
    shopId,
    from,
  );

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    totals: funnel(totals ?? {}),
    attributed: {
      direct: { orders: n(att("direct")?.orders), revenue: n(att("direct")?.revenue) },
      influenced: { orders: n(att("influenced")?.orders), revenue: n(att("influenced")?.revenue) },
      currency: (att("direct")?.currency ?? att("influenced")?.currency ?? null) as string | null,
    },
    byWidget: widgetRows.map((r) => ({ ...funnel(r), widgetId: String(r.widget_id), name: String(r.name) })),
    byVideo: videoRows.map((r) => ({
      ...funnel(r),
      videoId: String(r.video_id),
      title: String(r.title),
      poster: (r.poster as string | null) ?? null,
    })),
    topProducts: topProducts.map((r) => ({
      productId: String(r.product_id),
      orders: n(r.orders),
      revenue: n(r.revenue),
      carts: n(r.carts),
    })),
    daily: daily.map((r) => ({ day: String(r.day), views: n(r.views), carts: n(r.carts), revenue: n(r.revenue) })),
  };
}
