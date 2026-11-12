/**
 * Queues recurring jobs. Each slot gets a dedupe key, so several worker
 * instances can run the scheduler without queueing work twice.
 */
import { enqueue, type JobKind } from "@sv/core";

interface Recurring {
  kind: JobKind;
  everyMs: number;
}

export const RECURRING: Recurring[] = [
  { kind: "stats.rollup", everyMs: 5 * 60_000 },
  { kind: "stats.attribute", everyMs: 5 * 60_000 },
  { kind: "sync.schedule", everyMs: 60 * 60_000 },
  { kind: "events.cleanup", everyMs: 24 * 60 * 60_000 },
];

export async function scheduleDue(now = Date.now()) {
  for (const r of RECURRING) {
    const slot = Math.floor(now / r.everyMs);
    await enqueue(r.kind, { slot }, { dedupeKey: `${r.kind}:${slot}`, maxAttempts: 3 });
  }
}

export function startScheduler(intervalMs = 60_000) {
  const run = () =>
    scheduleDue().catch((err) =>
      console.log(JSON.stringify({ msg: "schedule failed", error: String(err) })),
    );
  void run();
  const t = setInterval(run, intervalMs);
  return { stop: () => clearInterval(t) };
}
