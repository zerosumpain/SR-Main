/**
 * Core activity fabric checks against a real Postgres schema.
 *
 * The merge gate excludes integration tests. This suite writes only beneath
 * two synthetic principals and deletes those principals after the run, so it
 * is safe against an otherwise populated local/test database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityConnections,
  activityConsumerGrants,
  activityEvents,
  activityPrincipals,
  activitySyncJobs,
} from '$lib/db/schema';
import { authorizeActivityRead } from '../contracts';
import { fixtureActivityProvider } from '../providers/fixture/adapter';
import { executeActivityJob } from '../sync/runner.server';
import { enqueueActivityJob } from '../sync/queue.server';
import {
  createActivityConnection,
  requestActivityConnectionErasure,
} from './connections.server';
import { persistActivityPage } from './events.server';
import { listActivityGrants, replaceActivityGrants } from './grants.server';

const PRINCIPALS = ['activity-itest-a', 'activity-itest-b'];

async function cleanup() {
  await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, PRINCIPALS));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(activityPrincipals).values(
    PRINCIPALS.map((id) => ({ id, kind: 'user', externalRef: id, label: id })),
  );
});

afterAll(cleanup);

describe('activity fabric persistence', () => {
  it('isolates principals, replays pages idempotently, applies grants and erases', async () => {
    const [connectionA, connectionB] = await Promise.all(
      PRINCIPALS.map((principalId) =>
        createActivityConnection({
          principalId,
          provider: 'fixture',
          mode: 'api_key',
          allowUnavailable: true,
        }),
      ),
    );
    const observedAt = '2026-09-04T12:00:00.000Z';

    for (const [principalId, connection] of [
      [PRINCIPALS[0], connectionA],
      [PRINCIPALS[1], connectionB],
    ] as const) {
      const context = {
        principalId,
        connectionId: connection.id,
        providerId: 'fixture',
        mode: 'api_key' as const,
        scopes: [],
        observedAt,
        cursor: null,
      };
      for await (const page of fixtureActivityProvider.sync!(context)) {
        const first = await persistActivityPage({
          adapter: fixtureActivityProvider,
          principalId,
          connectionId: connection.id,
          stream: 'itest',
          page,
          observedAt,
        });
        expect(first.inserted).toBe(page.events.length);
        const replay = await persistActivityPage({
          adapter: fixtureActivityProvider,
          principalId,
          connectionId: connection.id,
          stream: 'itest',
          page,
          observedAt,
        });
        expect(replay).toEqual({ inserted: 0, duplicates: page.events.length });
      }
    }

    const rows = await db
      .select({ principalId: activityEvents.principalId })
      .from(activityEvents)
      .where(inArray(activityEvents.principalId, PRINCIPALS));
    expect(rows.filter((row) => row.principalId === PRINCIPALS[0])).toHaveLength(5);
    expect(rows.filter((row) => row.principalId === PRINCIPALS[1])).toHaveLength(5);

    const initialGrants = await listActivityGrants(PRINCIPALS[0], connectionA.id);
    expect(initialGrants.every((grant) => grant.allowed === false)).toBe(true);
    const choice = {
      consumer: 'jkai' as const,
      dataClass: 'activity' as const,
      category: null,
      allowed: true,
    };
    const updated = await replaceActivityGrants({
      principalId: PRINCIPALS[0],
      connectionId: connectionA.id,
      expectedVersion: connectionA.version,
      grants: [choice],
    });
    expect(
      authorizeActivityRead(
        {
          principalId: PRINCIPALS[0],
          connectionId: connectionA.id,
          consumer: 'jkai',
          dataClass: 'activity',
          category: 'testing',
        },
        updated.grants,
      ).allowed,
    ).toBe(true);

    const firstSync = await enqueueActivityJob({
      principalId: PRINCIPALS[0],
      connectionId: connectionA.id,
      provider: 'fixture',
      kind: 'initial_sync',
      idempotencyKey: 'itest-first',
    });
    const coalescedSync = await enqueueActivityJob({
      principalId: PRINCIPALS[0],
      connectionId: connectionA.id,
      provider: 'fixture',
      kind: 'incremental_sync',
      idempotencyKey: 'itest-second',
    });
    expect(firstSync.inserted).toBe(true);
    expect(coalescedSync).toEqual({ id: firstSync.id, inserted: false });

    const erase = await requestActivityConnectionErasure(PRINCIPALS[0], connectionA.id);
    const [eraseJob] = await db
      .select()
      .from(activitySyncJobs)
      .where(and(eq(activitySyncJobs.id, erase.jobId), eq(activitySyncJobs.principalId, PRINCIPALS[0])))
      .limit(1);
    expect(eraseJob).toBeDefined();
    await executeActivityJob(eraseJob, 'activity-itest-worker');

    const [remainingConnections, remainingEvents, remainingGrants] = await Promise.all([
      db
        .select({ id: activityConnections.id })
        .from(activityConnections)
        .where(eq(activityConnections.id, connectionA.id)),
      db
        .select({ id: activityEvents.id })
        .from(activityEvents)
        .where(eq(activityEvents.connectionId, connectionA.id)),
      db
        .select({ id: activityConsumerGrants.id })
        .from(activityConsumerGrants)
        .where(eq(activityConsumerGrants.connectionId, connectionA.id)),
    ]);
    expect(remainingConnections).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
    expect(remainingGrants).toHaveLength(0);

    const otherPrincipalEvents = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(eq(activityEvents.principalId, PRINCIPALS[1]));
    expect(otherPrincipalEvents).toHaveLength(5);
  });
});
