/**
 * Ingest API (plan, C3): receiver, validator (known shop, valid schema, rate
 * limit per shop) and batch writer (bulk inserts into events).
 * The web pixel is the only storefront traffic that reaches our servers.
 */
import http from "node:http";
import { validateBatch, type SvEvent } from "@sv/shared";
import { prisma, type Db } from "@sv/core";

export interface IngestOptions {
  db?: Db;
  /** Max rows buffered before a flush */
  flushRows?: number;
  flushIntervalMs?: number;
  /** Batches per second allowed per shop, with a burst of 4x */
  shopRatePerSec?: number;
  maxBodyBytes?: number;
  shopCacheMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

interface Row {
  ts: Date;
  shopId: string;
  clientId: string;
  type: string;
  widgetId: string | null;
  videoId: string | null;
  productId: string | null;
  value: number | null;
  payload: object | undefined;
}

export function createIngest(opts: IngestOptions = {}) {
  const db = opts.db ?? prisma;
  const flushRows = opts.flushRows ?? 500;
  const flushIntervalMs = opts.flushIntervalMs ?? 1000;
  const rate = opts.shopRatePerSec ?? 20;
  const burst = rate * 4;
  const maxBody = opts.maxBodyBytes ?? 64 * 1024;
  const shopCacheMs = opts.shopCacheMs ?? 5 * 60_000;
  const log = opts.log ?? ((m, e) => console.log(JSON.stringify({ msg: m, ...e })));

  const shopCache = new Map<string, { id: string | null; until: number }>();
  const buckets = new Map<string, { tokens: number; at: number }>();
  let buffer: Row[] = [];
  let flushing: Promise<void> | null = null;

  async function shopId(domain: string): Promise<string | null> {
    const now = Date.now();
    const hit = shopCache.get(domain);
    if (hit && hit.until > now) return hit.id;
    const shop = await db.shop.findUnique({
      where: { domain },
      select: { id: true, uninstalledAt: true },
    });
    const id = shop && !shop.uninstalledAt ? shop.id : null;
    shopCache.set(domain, { id, until: now + (id ? shopCacheMs : 60_000) });
    return id;
  }

  function allow(shop: string): boolean {
    const now = Date.now();
    const b = buckets.get(shop) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(shop, b);
      return false;
    }
    b.tokens -= 1;
    buckets.set(shop, b);
    return true;
  }

  function toRow(shop: string, clientId: string, e: SvEvent): Row {
    return {
      ts: new Date(e.ts),
      shopId: shop,
      clientId,
      type: e.type,
      widgetId: e.widgetId ?? null,
      videoId: e.videoId ?? null,
      productId: e.productId ?? null,
      value: e.value ?? null,
      payload: e.order ? { ...e.order } : undefined,
    };
  }

  async function flush(): Promise<void> {
    if (flushing) await flushing;
    if (buffer.length === 0) return;
    const rows = buffer;
    buffer = [];
    flushing = (async () => {
      try {
        await db.event.createMany({ data: rows });
      } catch (err) {
        log("flush failed", { rows: rows.length, error: String(err) });
        // Put rows back once; if the DB is down for long we drop rather
        // than grow without bound.
        if (buffer.length < flushRows * 10) buffer = rows.concat(buffer);
      }
    })();
    await flushing;
    flushing = null;
  }

  const timer = setInterval(() => void flush(), flushIntervalMs);
  timer.unref();

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    // The pixel runs in a sandboxed iframe with an opaque origin; no
    // cookies are used, so a wildcard is safe.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");

    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") return end(res, 204);
    if (req.method === "GET" && url.pathname === "/healthz") return end(res, 200, "ok");
    if (req.method !== "POST" || url.pathname !== "/v1/events") return end(res, 404);

    let body: string;
    try {
      body = await readBody(req, maxBody);
    } catch {
      return end(res, 413);
    }

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return end(res, 400, "json");
    }

    const result = validateBatch(json);
    if (!result.ok) return end(res, 400, result.error);
    const { batch } = result;

    if (!allow(batch.shop)) return end(res, 429);
    const id = await shopId(batch.shop);
    if (!id) return end(res, 403, "shop");

    for (const e of batch.events) buffer.push(toRow(id, batch.clientId, e));
    if (buffer.length >= flushRows) void flush();
    return end(res, 202);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log("request failed", { error: String(err) });
      if (!res.headersSent) end(res, 500);
    });
  });

  async function close() {
    clearInterval(timer);
    await new Promise<void>((r) => server.close(() => r()));
    await flush();
  }

  return { server, flush, close, bufferedCount: () => buffer.length };
}

function end(res: http.ServerResponse, status: number, text = "") {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain");
  res.end(text);
}

function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
