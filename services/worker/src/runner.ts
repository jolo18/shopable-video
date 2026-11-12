/**
 * Job runner (plan, C3): polls the Postgres queue and dispatches to handlers.
 */
import os from "node:os";
import {
  claim,
  complete,
  fail,
  requeueStale,
  type ClaimedJob,
  type JobKind,
} from "@sv/core";

export type Handler = (job: ClaimedJob) => Promise<void>;
export type Handlers = Partial<Record<JobKind, Handler>>;

export interface RunnerOptions {
  handlers: Handlers;
  concurrency?: number;
  pollMs?: number;
  workerId?: string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export function createRunner(opts: RunnerOptions) {
  const concurrency = opts.concurrency ?? 4;
  const pollMs = opts.pollMs ?? 1000;
  const workerId = opts.workerId ?? `${os.hostname()}:${process.pid}`;
  const log = opts.log ?? ((m, e) => console.log(JSON.stringify({ msg: m, ...e })));
  const kinds = Object.keys(opts.handlers) as JobKind[];
  let running = 0;
  let stopped = false;
  let lastStaleCheck = 0;

  async function runJob(job: ClaimedJob) {
    const handler = opts.handlers[job.kind];
    const started = Date.now();
    try {
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      await handler(job);
      await complete(job.id);
      log("job done", { id: String(job.id), kind: job.kind, ms: Date.now() - started });
    } catch (err) {
      const outcome = await fail(job, err);
      if (outcome === "failed" || !(err instanceof Error && err.name === "RetryLater")) {
        log("job error", {
          id: String(job.id),
          kind: job.kind,
          outcome,
          attempt: job.attempts,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** One poll: claims what fits and runs it. Returns jobs started. */
  async function tick(): Promise<number> {
    if (Date.now() - lastStaleCheck > 60_000) {
      lastStaleCheck = Date.now();
      await requeueStale();
    }
    const free = concurrency - running;
    if (free <= 0) return 0;
    const jobs = await claim(workerId, free, kinds);
    for (const job of jobs) {
      running++;
      void runJob(job).finally(() => running--);
    }
    return jobs.length;
  }

  /** Runs until stop(). */
  async function start() {
    while (!stopped) {
      let started = 0;
      try {
        started = await tick();
      } catch (err) {
        log("poll failed", { error: String(err) });
      }
      if (started === 0) await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** For tests: run until the queue has nothing due. */
  async function drain(maxRounds = 100) {
    for (let i = 0; i < maxRounds; i++) {
      const jobs = await claim(workerId, concurrency, kinds);
      if (jobs.length === 0 && running === 0) return;
      await Promise.all(jobs.map(runJob));
    }
  }

  async function stop() {
    stopped = true;
    while (running > 0) await new Promise((r) => setTimeout(r, 100));
  }

  return { start, stop, tick, drain };
}
