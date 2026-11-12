import { beforeEach, describe, expect, it } from "vitest";
import { claim, complete, enqueue, fail, PermanentError, RetryLater } from "../src/jobs/queue";
import { prisma, resetDb } from "../../../test/db";

describe("job queue", () => {
  beforeEach(resetDb);

  it("claims each job once across workers", async () => {
    for (let i = 0; i < 6; i++) await enqueue("stats.rollup", { i });
    const [a, b] = await Promise.all([claim("a", 4), claim("b", 4)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("dedupes while queued, allows again after completion", async () => {
    expect(await enqueue("stats.rollup", {}, { dedupeKey: "k" })).not.toBeNull();
    expect(await enqueue("stats.rollup", {}, { dedupeKey: "k" })).toBeNull();
    const [job] = await claim("w");
    await complete(job.id);
    expect(await enqueue("stats.rollup", {}, { dedupeKey: "k" })).not.toBeNull();
  });

  it("retries with backoff, then fails", async () => {
    await enqueue("stats.rollup", {}, { maxAttempts: 2 });
    let [job] = await claim("w");
    expect(await fail(job, new Error("boom"))).toBe("retry");
    await prisma.job.updateMany({ data: { runAt: new Date() } });
    [job] = await claim("w");
    expect(job.attempts).toBe(2);
    expect(await fail(job, new Error("boom"))).toBe("failed");
  });

  it("does not count RetryLater as an attempt, fails fast on PermanentError", async () => {
    await enqueue("video.poll_status");
    let [job] = await claim("w");
    await fail(job, new RetryLater(0));
    [job] = await claim("w");
    expect(job.attempts).toBe(1);
    expect(await fail(job, new PermanentError("bad"))).toBe("failed");
  });

  it("only claims requested kinds", async () => {
    await enqueue("stats.rollup");
    expect(await claim("w", 5, ["events.cleanup"])).toHaveLength(0);
  });
});
