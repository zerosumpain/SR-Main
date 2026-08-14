/**
 * Adopting research runs that lost their worker.
 *
 * Worker state is process-local (`activeEmitters`, `abortControllers` in
 * `worker.ts`) and `startResearch` is fire-and-forget, so a deploy landing
 * mid-run left the session in a non-terminal status forever. Measured on
 * production 2026-08-14: **seven of thirty-one sessions stranded** in `phase1`,
 * `phase3` or `post_processing` — the oldest since April — and CI deploys on
 * every merge to master, so the exposure is continuous rather than rare.
 *
 * Liveness is decided by `heartbeatAt`, written explicitly by a running worker.
 * It is NOT derived by subtracting `updatedAt`: a row touched by an unrelated
 * write would read as alive, and a worker sitting inside one long LLM call
 * would read as dead. That distinction has bitten this codebase before.
 */
import { db } from '$lib/db';
import { researchSessions, researchLeads } from '$lib/db/schema';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { startResearch, isRunning } from './worker';

/**
 * How quiet a session must be before another process may adopt it.
 *
 * Comfortably longer than the worker's 10s heartbeat interval, so ordinary
 * scheduling jitter or a slow query never looks like death — but short enough
 * that a redeploy resumes within a minute rather than leaving a user staring at
 * a frozen page.
 */
export const STALE_AFTER_MS = 90_000;

const NON_TERMINAL = ['phase1', 'phase2', 'phase3', 'post_processing'];

export interface ResumeResult {
  adopted: string[];
  skipped: number;
}

/**
 * Find sessions nobody is working on and restart them.
 *
 * A `draft` session is included: it means the row was created but its worker
 * never started, which is exactly what a crash between INSERT and
 * `startResearch` leaves behind.
 */
export async function resumeStrandedSessions(now = Date.now()): Promise<ResumeResult> {
  const cutoff = new Date(now - STALE_AFTER_MS);

  const candidates = await db
    .select({
      id: researchSessions.id,
      status: researchSessions.status,
      heartbeatAt: researchSessions.heartbeatAt,
      createdAt: researchSessions.createdAt,
    })
    .from(researchSessions)
    .where(
      and(
        inArray(researchSessions.status, [...NON_TERMINAL, 'draft']),
        // Never seen a heartbeat, or not for a while.
        or(isNull(researchSessions.heartbeatAt), lt(researchSessions.heartbeatAt, cutoff)),
        // Don't adopt a session created seconds ago — its worker may still be
        // booting and has not written its first beat yet.
        lt(researchSessions.createdAt, cutoff),
      ),
    )
    .limit(25);

  const adopted: string[] = [];
  let skipped = 0;

  for (const session of candidates) {
    // This process may itself be the owner — `isRunning` is process-local and
    // authoritative for that question.
    if (isRunning(session.id)) {
      skipped++;
      continue;
    }

    // Work that was in flight when the worker died is not lost, it is just
    // unowned. Requeue it so the resumed run picks it up rather than treating
    // it as complete.
    await db
      .update(researchLeads)
      .set({ status: 'queued', startedAt: null })
      .where(and(eq(researchLeads.sessionId, session.id), eq(researchLeads.status, 'running')));

    await db
      .update(researchSessions)
      .set({ resumedAt: new Date(), heartbeatAt: new Date() })
      .where(eq(researchSessions.id, session.id));

    console.log(`[deepdive] resuming stranded session ${session.id} (was ${session.status})`);
    startResearch(session.id);
    adopted.push(session.id);
  }

  return { adopted, skipped };
}

/**
 * Close out sessions too old to be worth resuming.
 *
 * Without this, the seven historic strays would be adopted on the next boot and
 * re-run research on questions asked four months ago — spending real money to
 * finish something nobody is waiting for. Anything older than the cutoff is
 * marked failed with an honest reason instead.
 */
export async function retireAncientSessions(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await db
    .update(researchSessions)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage: 'Abandoned — its worker was lost and the run was too old to resume',
    })
    .where(
      and(
        inArray(researchSessions.status, NON_TERMINAL),
        lt(researchSessions.createdAt, cutoff),
        sql`${researchSessions.heartbeatAt} IS NULL OR ${researchSessions.heartbeatAt} < ${cutoff}`,
      ),
    )
    .returning({ id: researchSessions.id });

  if (rows.length) {
    console.log(`[deepdive] retired ${rows.length} abandoned research session(s)`);
  }
  return rows.length;
}

/**
 * Boot hook: retire the ancient, adopt the recent.
 *
 * Order matters — retiring first stops a months-old session being adopted and
 * charged to the current bill.
 */
export async function runResumeSweep(): Promise<ResumeResult> {
  try {
    await retireAncientSessions();
  } catch (err) {
    console.error('[deepdive] retiring abandoned sessions failed:', err);
  }
  try {
    return await resumeStrandedSessions();
  } catch (err) {
    console.error('[deepdive] resume sweep failed:', err);
    return { adopted: [], skipped: 0 };
  }
}
