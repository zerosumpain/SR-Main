/**
 * #19 DURABLE RUN-WORKER — DB-backed run queue / claim mechanism.
 *
 * ADDITIVE + FEATURE-FLAGGED. Nothing in here runs unless the caller is in
 * worker mode (`JKAI_RUN_WORKER === '1'`); the in-process (flag-OFF) path never
 * imports/executes these functions, so production behaviour is unchanged.
 *
 * The queue reuses the existing `workflow_runs` table plus the three nullable
 * lease columns added in schema.ts (claimed_by / claimed_at / lease_expires_at).
 * A run is "queued" when status='pending' and unclaimed. A worker leases exactly
 * one pending run at a time using `SELECT ... FOR UPDATE SKIP LOCKED`, which lets
 * multiple workers poll concurrently without ever handing the same row to two of
 * them. Leases expire (lease_expires_at) so a worker that dies mid-run releases
 * its claim to the fleet without waiting on the heartbeat reaper.
 *
 * The SQL-building / decision helpers are split out as pure functions so they
 * can be unit-tested without a live DB.
 */

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

/** Default lease duration in ms. A claimed run's lease_expires_at is set to
 *  now()+LEASE_MS; the worker renews it via heartbeat well before expiry. */
export const DEFAULT_LEASE_MS = 60_000;

/** A row shape returned by claimNext — only the fields the worker needs. */
export interface ClaimedRun {
  id: string;
  workflowId: string;
  trigger: string;
}

/**
 * PURE: derive a stable worker id for this process. Combines hostname, pid and a
 * random suffix so two workers on the same host never collide. Exported for the
 * worker loop and for tests (deterministic given its inputs).
 */
export function deriveWorkerId(hostname: string, pid: number, rand: string): string {
  return `${hostname}:${pid}:${rand}`;
}

/**
 * PURE: compute a lease-expiry Date from a base time + duration. Centralised so
 * the renew/claim paths agree and the logic is unit-testable.
 */
export function computeLeaseExpiry(now: Date, leaseMs: number): Date {
  return new Date(now.getTime() + Math.max(0, leaseMs));
}

/**
 * PURE: is a lease expired relative to `now`? A null expiry counts as expired
 * (legacy/unclaimed rows). Used by releaseExpiredLeases' decision and by tests.
 */
export function isLeaseExpired(leaseExpiresAt: Date | null | undefined, now: Date): boolean {
  if (!leaseExpiresAt) return true;
  return leaseExpiresAt.getTime() <= now.getTime();
}

/**
 * PURE: decide whether a worker should be able to claim a row in this state.
 * A row is claimable when it is pending AND (unclaimed OR its lease has expired).
 * This mirrors the WHERE clause of the claim SQL and is the unit-test seam for
 * the claim predicate.
 */
export function isClaimable(
  row: { status: string; claimedBy: string | null; leaseExpiresAt: Date | null },
  now: Date,
): boolean {
  if (row.status !== 'pending') return false;
  if (row.claimedBy == null) return true;
  return isLeaseExpired(row.leaseExpiresAt, now);
}

/**
 * Mark a run as queued (status='pending', cleared lease). Idempotent — a run
 * inserted directly as 'pending' is already enqueued; this normalises the lease
 * columns so a re-enqueue (e.g. retry) re-offers the row to the fleet.
 */
export async function enqueue(runId: string): Promise<void> {
  await db.execute(sql`
    UPDATE workflow_runs
    SET status = 'pending',
        claimed_by = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL
    WHERE id = ${runId}
  `);
}

/**
 * Atomically lease the oldest pending+claimable run for this worker and flip it
 * to 'running'. Uses FOR UPDATE SKIP LOCKED so concurrent workers never block on
 * each other or double-claim. Returns the claimed run, or null if the queue is
 * empty. The lease is set to now()+leaseMs; the worker renews it via heartbeat.
 */
export async function claimNext(
  workerId: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<ClaimedRun | null> {
  // CTE: pick one claimable row with SKIP LOCKED, then UPDATE it to running and
  // stamp the lease. RETURNING gives the worker what it needs to execute.
  const leaseSeconds = Math.max(1, Math.round(leaseMs / 1000));
  const res = await db.execute(sql`
    WITH next AS (
      SELECT id
      FROM workflow_runs
      WHERE status = 'pending'
        AND (claimed_by IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= now())
      ORDER BY started_at ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE workflow_runs r
    SET status = 'running',
        claimed_by = ${workerId},
        claimed_at = now(),
        lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
        started_at = COALESCE(r.started_at, now()),
        heartbeat_at = now()
    FROM next
    WHERE r.id = next.id
    RETURNING r.id AS id, r.workflow_id AS "workflowId", r.trigger AS trigger
  `);
  const rows = (res as unknown as { rows?: ClaimedRun[] }).rows ?? [];
  return rows[0] ?? null;
}

/**
 * Renew the lease for a run this worker owns (heartbeat). Only extends the lease
 * if the row is still claimed by this worker — a row reclaimed by another worker
 * (because this one's lease lapsed) is left alone. Best-effort.
 */
export async function renewLease(
  runId: string,
  workerId: string,
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<boolean> {
  const leaseSeconds = Math.max(1, Math.round(leaseMs / 1000));
  const res = await db.execute(sql`
    UPDATE workflow_runs
    SET lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
        heartbeat_at = now()
    WHERE id = ${runId} AND claimed_by = ${workerId}
  `);
  const count = (res as { rowCount?: number }).rowCount ?? 0;
  return count > 0;
}

/**
 * Clear the lease on a finished run (whatever its terminal status). Scoped to
 * this worker so we never stomp a row another worker reclaimed mid-flight.
 */
export async function clearLease(runId: string, workerId: string): Promise<void> {
  await db.execute(sql`
    UPDATE workflow_runs
    SET claimed_by = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL
    WHERE id = ${runId} AND claimed_by = ${workerId}
  `);
}

/**
 * Release leases on pending rows whose lease has expired so they become
 * re-claimable. Note: 'running' rows are owned by the heartbeat reaper
 * (engine-runtime.reapStaleRuns) — this only re-offers rows that were claimed
 * then never advanced. Returns the number of rows released.
 */
export async function releaseExpiredLeases(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE workflow_runs
    SET claimed_by = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL
    WHERE status = 'pending'
      AND claimed_by IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= now()
  `);
  return (res as { rowCount?: number }).rowCount ?? 0;
}
