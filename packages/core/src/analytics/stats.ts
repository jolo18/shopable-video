/**
 * Stats jobs (plan, C3): rollups, order attribution and event cleanup.
 * Mostly SQL. All of them are idempotent, so the scheduler can rerun them.
 */
import { prisma, type Db } from "../db";

export const EVENT_RETENTION_DAYS = 14;
export const ATTRIBUTION_WINDOW_DAYS = 7;

/**
 * Attributes orders from checkout_completed events in the lookback window.
 * direct: the shopper added the item to cart from a video and bought it
 * within 7 days (most recent add wins). influenced: the shopper watched a
 * video in the 7 days before ordering. Kept apart by `kind`.
 */
export async function attributeOrders(lookbackHours = 48, db: Db = prisma) {
  const since = new Date(Date.now() - lookbackHours * 3600_000);

  const direct = await db.$executeRaw`
    WITH orders AS (
      SELECT e.shop_id, e.client_id, e.ts, e.payload->>'orderId' AS order_id,
             e.payload->>'currency' AS currency, e.payload->'lines' AS lines
      FROM events e
      WHERE e.type = 'checkout_completed' AND e.ts >= ${since}
    ),
    lines AS (
      SELECT o.*, l->>'productId' AS product_id, (l->>'price')::numeric AS line_value
      FROM orders o, jsonb_array_elements(o.lines) l
    ),
    matched AS (
      SELECT DISTINCT ON (li.shop_id, li.order_id, li.product_id)
        li.shop_id, li.order_id, li.client_id, a.video_id, li.product_id, li.line_value, li.currency, li.ts
      FROM lines li
      JOIN events a ON a.shop_id = li.shop_id AND a.client_id = li.client_id
        AND a.type = 'sv_add_to_cart' AND a.video_id IS NOT NULL
        AND a.product_id = li.product_id
        AND a.ts <= li.ts AND a.ts >= li.ts - (${ATTRIBUTION_WINDOW_DAYS}::int * interval '1 day')
      ORDER BY li.shop_id, li.order_id, li.product_id, a.ts DESC
    )
    INSERT INTO attributed_orders (shop_id, order_id, client_id, video_id, kind, product_id, value, currency, ordered_at)
    SELECT shop_id, order_id, client_id, video_id, 'direct', product_id, line_value, currency, ts FROM matched
    ON CONFLICT DO NOTHING`;

  const influenced = await db.$executeRaw`
    WITH orders AS (
      SELECT e.shop_id, e.client_id, e.ts, e.payload->>'orderId' AS order_id,
             e.payload->>'currency' AS currency,
             COALESCE(e.value::numeric, (SELECT SUM((l->>'price')::numeric) FROM jsonb_array_elements(e.payload->'lines') l), 0) AS total
      FROM events e
      WHERE e.type = 'checkout_completed' AND e.ts >= ${since}
    )
    INSERT INTO attributed_orders (shop_id, order_id, client_id, video_id, kind, product_id, value, currency, ordered_at)
    SELECT DISTINCT o.shop_id, o.order_id, o.client_id, v.video_id, 'influenced', '', o.total, o.currency, o.ts
    FROM orders o
    JOIN events v ON v.shop_id = o.shop_id AND v.client_id = o.client_id
      AND v.type = 'sv_view' AND v.video_id IS NOT NULL
      AND v.ts <= o.ts AND v.ts >= o.ts - (${ATTRIBUTION_WINDOW_DAYS}::int * interval '1 day')
    ON CONFLICT DO NOTHING`;

  return { direct, influenced };
}

/**
 * Rebuilds stats_daily for the days that still have raw events in the
 * lookback window. Rows are split by widget and video ("" = not set).
 * orders and revenue count direct attribution only.
 */
export async function rollup(lookbackDays = 2, db: Db = prisma) {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - (lookbackDays - 1));

  await db.$transaction([
    db.$executeRaw`DELETE FROM stats_daily WHERE day >= ${from}::date`,
    db.$executeRaw`
      INSERT INTO stats_daily (shop_id, day, widget_id, video_id, impressions, views, watch_ms, completions, clicks, carts, orders, revenue)
      SELECT shop_id, day, widget_id, video_id,
        SUM(impressions), SUM(views), SUM(watch_ms), SUM(completions), SUM(clicks), SUM(carts), SUM(orders), SUM(revenue)
      FROM (
        SELECT shop_id, (ts AT TIME ZONE 'UTC')::date AS day,
          COALESCE(widget_id, '') AS widget_id, COALESCE(video_id, '') AS video_id,
          COUNT(*) FILTER (WHERE type = 'sv_impression') AS impressions,
          COUNT(*) FILTER (WHERE type = 'sv_view') AS views,
          COALESCE(SUM(value) FILTER (WHERE type = 'sv_watch'), 0)::bigint AS watch_ms,
          COUNT(*) FILTER (WHERE type = 'sv_complete') AS completions,
          COUNT(*) FILTER (WHERE type = 'sv_click') AS clicks,
          COUNT(*) FILTER (WHERE type = 'sv_add_to_cart') AS carts,
          0::bigint AS orders, 0::numeric AS revenue
        FROM events
        WHERE ts >= ${from} AND type LIKE 'sv\\_%'
        GROUP BY 1, 2, 3, 4
        UNION ALL
        SELECT shop_id, (ordered_at AT TIME ZONE 'UTC')::date, '', video_id,
          0, 0, 0, 0, 0, 0, COUNT(DISTINCT order_id), SUM(value)
        FROM attributed_orders
        WHERE kind = 'direct' AND ordered_at >= ${from}
        GROUP BY 1, 2, 3, 4
      ) t
      GROUP BY shop_id, day, widget_id, video_id`,
  ]);
}

export async function cleanupEvents(db: Db = prisma) {
  return db.$executeRaw`DELETE FROM events WHERE ts < now() - (${EVENT_RETENTION_DAYS}::int * interval '1 day')`;
}
