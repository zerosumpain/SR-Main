/**
 * Backfill service — drives range-aware imports of Whoop and Strava data as
 * tracked, cancellable background jobs persisted in `health_sync_jobs`.
 *
 * Jobs run in-process. The HTTP handler returns a job id immediately; the
 * caller polls `/api/health/sync/jobs` for progress.
 */

import { randomUUID } from 'node:crypto';
import { db } from '$lib/db';
import { healthSyncJobs, type HealthSyncJob } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { syncStravaActivities, syncWhoopAll } from './sync-service';
import type { SyncOptions } from './types';

export type BackfillService = 'strava' | 'whoop' | 'all';

export interface BackfillRange {
  start?: string; // ISO 8601
  end?: string;
}

export interface BackfillJobInput extends BackfillRange {
  service: BackfillService;
}

interface RunHandle {
  controller: AbortController;
  promise: Promise<void>;
}

const runHandles = new Map<string, RunHandle>();

const now = () => Math.floor(Date.now() / 1000);

async function writeJob(id: string, patch: Partial<HealthSyncJob>) {
  await db.update(healthSyncJobs).set(patch).where(eq(healthSyncJobs.id, id));
}

/**
 * Throttled progress writer — coalesces hot updates so a 1000-record backfill
 * doesn't generate 1000 row UPDATEs.
 */
function makeProgressWriter(jobId: string) {
  let lastWriteAt = 0;
  let pending: { recordsSynced: number; pagesDone: number; currentStep: string } | null = null;
  let timer: NodeJS.Timeout | null = null;

  const flush = async () => {
    if (!pending) return;
    const snap = pending;
    pending = null;
    lastWriteAt = Date.now();
    try {
      await writeJob(jobId, snap);
    } catch (e) {
      console.error('progress flush failed:', e);
    }
  };

  return {
    enqueue(info: { step: string; recordsSynced: number; pagesDone: number }) {
      pending = {
        recordsSynced: info.recordsSynced,
        pagesDone: info.pagesDone,
        currentStep: info.step,
      };
      const since = Date.now() - lastWriteAt;
      if (since >= 500) {
        flush();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          flush();
        }, 500 - since);
      }
    },
    async final() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}

export async function startBackfillJob(input: BackfillJobInput): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  const startedAt = now();

  await db.insert(healthSyncJobs).values({
    id: jobId,
    service: input.service,
    mode: 'backfill',
    rangeStart: input.start ? Math.floor(new Date(input.start).getTime() / 1000) : null,
    rangeEnd: input.end ? Math.floor(new Date(input.end).getTime() / 1000) : null,
    status: 'running',
    startedAt,
  });

  const controller = new AbortController();
  const promise = runJob(jobId, input, controller.signal).catch((err) => {
    console.error(`backfill job ${jobId} crashed:`, err);
  });

  runHandles.set(jobId, { controller, promise });
  return { jobId };
}

async function runJob(jobId: string, input: BackfillJobInput, signal: AbortSignal) {
  const writer = makeProgressWriter(jobId);
  // Per-phase base offsets so cumulative progress aggregates across phases.
  let baseOffset = 0;

  const wrapProgress = (phaseName: string): SyncOptions['onProgress'] => (info) => {
    writer.enqueue({
      step: `${phaseName}:${info.step}`,
      recordsSynced: baseOffset + info.recordsSynced,
      pagesDone: info.pagesDone,
    });
  };

  const opts: SyncOptions = {
    fullBackfill: true,
    start: input.start,
    end: input.end,
    signal,
  };

  let recordsSynced = 0;
  const errors: string[] = [];

  try {
    if (input.service === 'strava' || input.service === 'all') {
      await writeJob(jobId, { currentStep: 'strava' });
      const r = await syncStravaActivities({
        ...opts,
        onProgress: wrapProgress('strava'),
      });
      recordsSynced += r.recordsSynced;
      baseOffset = recordsSynced;
      errors.push(...r.errors);
    }

    if (signal.aborted) {
      await finalize(jobId, 'cancelled', recordsSynced, 'Cancelled by user');
      await writer.final();
      runHandles.delete(jobId);
      return;
    }

    if (input.service === 'whoop' || input.service === 'all') {
      await writeJob(jobId, { currentStep: 'whoop' });
      const r = await syncWhoopAll({
        ...opts,
        onProgress: wrapProgress('whoop'),
      });
      recordsSynced += r.recordsSynced;
      errors.push(...r.errors);
    }

    const status = signal.aborted ? 'cancelled' : errors.length === 0 ? 'success' : 'error';
    await finalize(jobId, status, recordsSynced, errors.join('; ') || null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalize(jobId, 'error', recordsSynced, msg);
  } finally {
    await writer.final();
    runHandles.delete(jobId);
  }
}

async function finalize(
  jobId: string,
  status: 'success' | 'error' | 'cancelled',
  recordsSynced: number,
  errorMessage: string | null,
) {
  await writeJob(jobId, {
    status,
    finishedAt: now(),
    recordsSynced,
    errorMessage,
  });
}

export async function cancelBackfillJob(jobId: string): Promise<{ ok: boolean; reason?: string }> {
  const handle = runHandles.get(jobId);
  if (!handle) return { ok: false, reason: 'Job not running on this instance' };
  await writeJob(jobId, { cancelRequested: true });
  handle.controller.abort();
  return { ok: true };
}

export async function listJobs(limit = 25): Promise<HealthSyncJob[]> {
  return db.select().from(healthSyncJobs).orderBy(desc(healthSyncJobs.startedAt)).limit(limit);
}

export async function getJob(jobId: string): Promise<HealthSyncJob | null> {
  const rows = await db
    .select()
    .from(healthSyncJobs)
    .where(eq(healthSyncJobs.id, jobId))
    .limit(1);
  return rows[0] ?? null;
}
