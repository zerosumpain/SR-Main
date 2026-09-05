/**
 * A job that fails for a NON-retryable reason must be marked failed, not
 * left running under its lease.
 *
 * Regression: `claimNextActivityJob` maps raw driver rows, where timestamps
 * arrive as strings. `failActivityJob` wrote the claimed `runAfter` back on
 * the non-retryable path, drizzle called `.toISOString()` on the string, the
 * catch block threw, and the job sat `running` until its lease expired — then
 * was claimed and failed the same way, five times over. Every policy,
 * credential and private-source failure took this path.
 *
 * Writes only beneath one synthetic principal and removes it afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityConnections, activityPrincipals, activitySyncJobs } from '$lib/db/schema';
import { createActivityConnection } from '../store/connections.server';
import { enqueueActivityJob } from './queue.server';
import { runNextActivityJob } from './runner.server';

const PRINCIPAL = 'activity-itest-failure';
const WORKER = 'activity-itest-failure-worker';

async function cleanup() {
  await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, [PRINCIPAL]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(activityPrincipals).values({ id: PRINCIPAL, kind: 'user', externalRef: PRINCIPAL, label: PRINCIPAL });
});

afterAll(cleanup);

describe('non-retryable job failure', () => {
  it('marks the job failed and the connection action_required instead of throwing', async () => {
    const connection = await createActivityConnection({
      principalId: PRINCIPAL,
      provider: 'fixture',
      mode: 'api_key',
      allowUnavailable: true,
    });
    // A disconnected connection is refused by the runner before any flag or
    // adapter is consulted, so the test does not depend on settings state.
    await db
      .update(activityConnections)
      .set({ status: 'disconnected' })
      .where(eq(activityConnections.id, connection.id));
    const job = await enqueueActivityJob({
      principalId: PRINCIPAL,
      connectionId: connection.id,
      provider: 'fixture',
      kind: 'initial_sync',
      idempotencyKey: `itest-failure:${connection.id}`,
      priority: 1,
    });

    // The runner claims globally; loop until it reaches this job or runs dry.
    let outcome: Awaited<ReturnType<typeof runNextActivityJob>> | null = null;
    for (let i = 0; i < 10; i++) {
      const result = await runNextActivityJob(WORKER);
      if (result.outcome === 'empty') break;
      if (result.jobId === job.id) {
        outcome = result;
        break;
      }
    }
    expect(outcome?.outcome).toBe('failed');
    expect(outcome?.detail).toMatchObject({ kind: 'policy_blocked' });

    const [row] = await db.select().from(activitySyncJobs).where(eq(activitySyncJobs.id, job.id));
    expect(row.status).toBe('failed');
    expect(row.leaseOwner).toBeNull();
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.errorCode).toBe('policy_blocked');

    const [conn] = await db.select().from(activityConnections).where(eq(activityConnections.id, connection.id));
    expect(conn.status).toBe('action_required');
    expect(conn.healthStatus).toBe('policy_blocked');
  }, 30_000);
});
