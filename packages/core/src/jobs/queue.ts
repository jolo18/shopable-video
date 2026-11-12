/**
 * Plain Postgres job queue (plan, open decision 1: no Node-only queue
 * library). Workers claim jobs with FOR UPDATE SKIP LOCKED, so any number of
 * worker instances can run side by side.
 */
import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";

export const JOB_KINDS = [
  "import.video", // one social video: fetch, dedupe, upload, wait, save
  "import.profile_sync", // daily sync of one social account
  "sync.schedule", // queue profile syncs that are due
  "video.poll_status", // wait for Shopify to finish processing a file
  "stats.rollup",
  "stats.attribute",
  "events.cleanup",
  "shop.publish_all", // rebuild everything on the Shopify side
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface EnqueueOptions {
  shopId?: string | null;
  runAt?: Date;
  maxAttempts?: number;
  /** A queued or running job with this key blocks a duplicate */
  dedupeKey?: string;
}

export interface ClaimedJob {
  id: bigint;
  kind: JobKind;
  shopId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown> = {},
  opts: EnqueueOptions = {},
  db: Db = prisma,
): Promise<bigint | null> {
  try {
    const job = await db.job.create({
      data: {
        kind,
        payload: payload as Prisma.InputJsonValue,
        shopId: opts.shopId ?? null,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 5,
        dedupeKey: opts.dedupeKey ?? null,
      },
      select: { id: true },
    });
    return job.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null; // dedupe hit
    throw err;
  }
}

/** Claims up to `limit` due jobs. */
export async function claim(
  workerId: string,
  limit = 5,
  kinds?: readonly JobKind[],
  db: Db = prisma,
): Promise<ClaimedJob[]> {
  const kindFilter = kinds?.length ? kinds : JOB_KINDS;
  const rows = await db.$queryRaw<
    Array<{
      id: bigint;
      kind: string;
      shop_id: string | null;
      payload: unknown;
      attempts: number;
      max_attempts: number;
    }>
  >`
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_at <= now() AND kind = ANY(${kindFilter as unknown as string[]})
      ORDER BY run_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, shop_id::text, payload, attempts, max_attempts`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as JobKind,
    shopId: r.shop_id,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

export async function complete(id: bigint, db: Db = prisma): Promise<void> {
  // Clear the dedupe key so the same work can be queued again later.
  await db.job.update({
    where: { id },
    data: { status: "done", lockedAt: null, dedupeKey: null },
  });
}

/** Thrown by a handler to re-run the job later without counting a failure. */
export class RetryLater extends Error {
  constructor(public readonly delayMs: number, message = "retry later") {
    super(message);
    this.name = "RetryLater";
  }
}

/** Thrown by a handler when retrying cannot help. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export async function fail(
  job: Pick<ClaimedJob, "id" | "attempts" | "maxAttempts">,
  err: unknown,
  db: Db = prisma,
): Promise<"retry" | "failed"> {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof RetryLater) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "queued",
        lockedAt: null,
        lockedBy: null,
        // A deliberate wait does not use up an attempt.
        attempts: { decrement: 1 },
        runAt: new Date(Date.now() + err.delayMs),
        lastError: null,
      },
    });
    return "retry";
  }
  const permanent = err instanceof PermanentError;
  if (!permanent && job.attempts < job.maxAttempts) {
    const delay = Math.min(30_000 * 2 ** (job.attempts - 1), 60 * 60_000);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "queued",
        lockedAt: null,
        lockedBy: null,
        runAt: new Date(Date.now() + delay),
        lastError: message.slice(0, 2000),
      },
    });
    return "retry";
  }
  await db.job.update({
    where: { id: job.id },
    data: {
      status: "failed",
      lockedAt: null,
      lastError: message.slice(0, 2000),
      dedupeKey: null,
    },
  });
  return "failed";
}

/** Puts jobs whose worker died back in the queue. */
export async function requeueStale(
  olderThanMs = 15 * 60_000,
  db: Db = prisma,
): Promise<number> {
  return db.$executeRaw`
    UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE status = 'running' AND locked_at < now() - (${olderThanMs}::int * interval '1 millisecond')`;
}
