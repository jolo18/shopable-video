import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createIngest } from "../src/server";
import { makeShop, prisma, resetDb } from "../../../test/db";

let ingest: ReturnType<typeof createIngest>;
let url: string;

async function post(body: unknown) {
  return fetch(`${url}/v1/events`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("ingest", () => {
  beforeEach(async () => {
    await resetDb();
    ingest = createIngest({ flushIntervalMs: 60_000, shopRatePerSec: 1, log: () => {} });
    await new Promise<void>((r) => ingest.server.listen(0, r));
    url = `http://127.0.0.1:${(ingest.server.address() as AddressInfo).port}`;
  });
  afterEach(() => ingest.close());

  it("writes valid events for a known shop", async () => {
    await makeShop("a.myshopify.com");
    const res = await post({
      shop: "a.myshopify.com",
      clientId: "c1",
      events: [{ type: "sv_view", ts: Date.now(), videoId: "v1" }],
    });
    expect(res.status).toBe(202);
    await ingest.flush();
    const rows = await prisma.event.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "sv_view", clientId: "c1", videoId: "v1" });
  });

  it("rejects unknown shops and bad bodies", async () => {
    const ev = [{ type: "sv_view", ts: Date.now() }];
    expect((await post({ shop: "x.myshopify.com", clientId: "c", events: ev })).status).toBe(403);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ shop: "x.myshopify.com", clientId: "c", events: [] })).status).toBe(400);
  });

  it("rate limits per shop", async () => {
    await makeShop("a.myshopify.com");
    const body = { shop: "a.myshopify.com", clientId: "c", events: [{ type: "sv_view", ts: Date.now() }] };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(body)).status);
    expect(statuses).toContain(429);
  });

  it("answers CORS preflight and health", async () => {
    const pre = await fetch(`${url}/v1/events`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });
});
