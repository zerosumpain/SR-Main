import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activitySyncJobs, type ActivitySyncJob } from '$lib/db/schema';
import { randomActivityId, stableActivityId } from '../store/ids';
import {
  computeActivityRetryDelayMs,
  isRetryableActivityFailure,
  safeActivityErrorText,
  type ActivitySyncFailureKind,
} from './errors';

export const ACTIVITY_JOB_LEASE_MS = 2 * 60 * 1000;

export type ActivityJobKind =
  | 'initial_sync'
  | 'incremental_sync'
  | 'inspect_import'
  | 'import'
  | 'erase'
  | 'reproject';

export async function enqueueActivityJob(input: {
  principalId: string;
  connectionId: string | null;
  provider: string;
  kind: ActivityJobKind;
  priority?: number;
  idempotencyKey?: string;
  checkpoint?: Record<string, unknown>;
}): Promise<{ id: string; inserted: boolean }> {
  const id = input.idempotencyKey
    ? stableActivityId('ajob', [input.principalId, input.kind, input.idempotencyKey])
    : randomActivityId('ajob');
  const values = {
    id,
    principalId: input.principalId,
    connectionId: input.connectionId,
    provider: input.provider,
    kind: input.kind,
    priority: input.priority ?? 100,
    idempotencyKey: input.idempotencyKey,
    checkpoint: input.checkpoint ?? {},
  };
  const coalescedSync =
    input.connectionId !== null &&
    (input.kind === 'initial_sync' || input.kind === 'incremental_sync');
  if (coalescedSync) {
    const connectionId = input.connectionId!;
    return db.transaction(async (tx) => {
      const lockKey = `activity-sync:${input.principalId}:${connectionId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx
        .select({ id: activitySyncJobs.id })
        .from(activitySyncJobs)
        .where(
          and(
            eq(activitySyncJobs.principalId, input.principalId),
            eq(activitySyncJobs.connectionId, connectionId),
            inArray(activitySyncJobs.kind, ['initial_sync', 'incremental_sync']),
            inArray(activitySyncJobs.status, ['queued', 'retry_wait', 'running']),
          ),
        )
        .limit(1);
      if (existing) return { id: existing.id, inserted: false };
      const rows = await tx
        .insert(activitySyncJobs)
        .values(values)
        .onConflictDoNothing({ target: activitySyncJobs.id })
        .returning({ id: activitySyncJobs.id });
      return { id, inserted: rows.length > 0 };
    });
  }
  const rows = await db
    .insert(activitySyncJobs)
    .values(values)
    .onConflictDoNothing({ target: activitySyncJobs.id })
    .returning({ id: activitySyncJobs.id });
  return { id, inserted: rows.length > 0 };
}

export async function claimNextActivityJob(
  workerId: string,
  leaseMs: number = ACTIVITY_JOB_LEASE_MS,
): Promise<ActivitySyncJob | null> {
  const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1_000));
  const res = await db.execute(sql`
    WITH next AS (
      SELECT id
      FROM activity_sync_jobs
      WHERE status IN ('queued', 'retry_wait')
        AND run_after <= now()
        AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= now())
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE activity_sync_jobs job
    SET status = 'running',
        lease_owner = ${workerId},
        lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
        attempt = job.attempt + 1,
        started_at = COALESCE(job.started_at, now()),
        updated_at = now(),
        error_code = NULL,
        error_text = NULL
    FROM next
    WHERE job.id = next.id
    RETURNING job.*
  `);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  return rows[0] ? mapJobRow(rows[0]) : null;
}

function mapJobRow(row: Record<string, unknown>): ActivitySyncJob {
  return {
    id: String(row.id),
    principalId: String(row.principal_id),
    connectionId: row.connection_id === null ? null : String(row.connection_id),
    provider: String(row.provider),
    kind: String(row.kind),
    status: String(row.status),
    priority: Number(row.priority),
    runAfter: row.run_after as Date,
    leaseOwner: row.lease_owner === null ? null : String(row.lease_owner),
    leaseExpiresAt: row.lease_expires_at as Date | null,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    idempotencyKey: row.idempotency_key === null ? null : String(row.idempotency_key),
    checkpoint: (row.checkpoint ?? {}) as Record<string, unknown>,
    progress: (row.progress ?? {}) as Record<string, unknown>,
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorText: row.error_text === null ? null : String(row.error_text),
    startedAt: row.started_at as Date | null,
    finishedAt: row.finished_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function completeActivityJob(
  jobId: string,
  workerId: string,
  progress: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .update(activitySyncJobs)
    .set({
      status: 'succeeded',
      progress,
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(activitySyncJobs.id, jobId), eq(activitySyncJobs.leaseOwner, workerId)))
    .returning({ id: activitySyncJobs.id });
  return rows.length > 0;
}

export async function updateActivityJobProgress(
  jobId: string,
  workerId: string,
  input: {
    checkpoint: Record<string, unknown>;
    progress: Record<string, unknown>;
  },
): Promise<boolean> {
  const rows = await db
    .update(activitySyncJobs)
    .set({
      checkpoint: input.checkpoint,
      progress: input.progress,
      leaseExpiresAt: new Date(Date.now() + ACTIVITY_JOB_LEASE_MS),
      updatedAt: new Date(),
    })
    .where(and(eq(activitySyncJobs.id, jobId), eq(activitySyncJobs.leaseOwner, workerId)))
    .returning({ id: activitySyncJobs.id });
  return rows.length > 0;
}

export async function failActivityJob(input: {
  job: ActivitySyncJob;
  workerId: string;
  kind: ActivitySyncFailureKind;
  error: unknown;
  retryAt?: Date;
}): Promise<'retry_wait' | 'failed' | 'lost_lease'> {
  const retryable =
    isRetryableActivityFailure(input.kind) && input.job.attempt < input.job.maxAttempts;
  const status = retryable ? 'retry_wait' : 'failed';
  const runAfter = retryable
    ? input.retryAt ??
      new Date(Date.now() + computeActivityRetryDelayMs({ attempt: input.job.attempt }))
    : input.job.runAfter;
  const rows = await db
    .update(activitySyncJobs)
    .set({
      status,
      runAfter,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: input.kind,
      errorText: safeActivityErrorText(input.error),
      finishedAt: retryable ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(activitySyncJobs.id, input.job.id), eq(activitySyncJobs.leaseOwner, input.workerId)),
    )
    .returning({ id: activitySyncJobs.id });
  if (rows.length === 0) return 'lost_lease';
  return status;
}

export async function cancelQueuedActivityJobs(
  principalId: string,
  connectionId: string,
): Promise<number> {
  const rows = await db
    .update(activitySyncJobs)
    .set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(activitySyncJobs.principalId, principalId),
        eq(activitySyncJobs.connectionId, connectionId),
        inArray(activitySyncJobs.status, ['queued', 'retry_wait']),
      ),
    )
    .returning({ id: activitySyncJobs.id });
  return rows.length;
}

export async function listActivityJobs(
  principalId: string,
  connectionId: string,
  limit = 25,
): Promise<ActivitySyncJob[]> {
  return db
    .select()
    .from(activitySyncJobs)
    .where(
      and(
        eq(activitySyncJobs.principalId, principalId),
        eq(activitySyncJobs.connectionId, connectionId),
      ),
    )
    .orderBy(desc(activitySyncJobs.createdAt))
    .limit(Math.max(1, Math.min(100, Math.floor(limit))));
}
