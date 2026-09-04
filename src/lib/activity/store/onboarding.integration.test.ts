/** Durable, owner-scoped source onboarding against a real Postgres schema. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityOnboardingSessions, activityPrincipals } from '$lib/db/schema';
import { createActivityConnection } from './connections.server';
import { listActivityGrants } from './grants.server';
import {
  ActivityOnboardingError,
  attachActivityOnboardingConnection,
  getActivityOnboardingSession,
  recordActivityExportRequest,
  requireActivityOnboardingSession,
  saveActivityOnboardingSelection,
  updateActivityOnboardingProgress,
} from './onboarding.server';

const PRINCIPALS = ['activity-onboarding-itest-a', 'activity-onboarding-itest-b'];

async function cleanup() {
  await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, PRINCIPALS));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(activityPrincipals).values(
    PRINCIPALS.map((id) => ({
      id,
      kind: 'user',
      externalRef: id,
      label: id,
    })),
  );
});

afterAll(cleanup);

describe('activity source onboarding', () => {
  it('persists an export wait without crossing the principal boundary', async () => {
    const session = await saveActivityOnboardingSelection({
      principalId: PRINCIPALS[0],
      outcomes: ['listen', 'interests'],
      selectedProvider: 'youtube_takeout',
      dataClasses: ['metadata'],
    });
    const requestedAt = new Date('2026-09-04T12:00:00.000Z');
    const waiting = await recordActivityExportRequest({
      principalId: PRINCIPALS[0],
      sessionId: session.id,
      now: requestedAt,
    });

    expect(waiting.status).toBe('waiting_export');
    expect(waiting.remindAt?.toISOString()).toBe('2026-09-05T12:00:00.000Z');
    expect(await getActivityOnboardingSession(PRINCIPALS[1], session.id)).toBeNull();
    await expect(requireActivityOnboardingSession(PRINCIPALS[1], session.id)).rejects.toMatchObject(
      {
        code: 'session_not_found',
      } satisfies Partial<ActivityOnboardingError>,
    );

    const resaved = await saveActivityOnboardingSelection({
      principalId: PRINCIPALS[0],
      sessionId: session.id,
      outcomes: ['listen'],
      selectedProvider: 'youtube_takeout',
      dataClasses: ['metadata', 'activity'],
    });
    expect(resaved.status).toBe('waiting_export');
    expect(resaved.exportRequestedAt?.toISOString()).toBe(requestedAt.toISOString());
  });

  it('attaches one matching connection and completes the resumable journey', async () => {
    const session = await saveActivityOnboardingSelection({
      principalId: PRINCIPALS[0],
      outcomes: ['play'],
      selectedProvider: 'steam',
      dataClasses: ['metadata'],
    });
    const connection = await createActivityConnection({
      principalId: PRINCIPALS[0],
      provider: 'steam',
      mode: 'openid',
      dataClasses: ['metadata'],
    });
    const attached = await attachActivityOnboardingConnection({
      principalId: PRINCIPALS[0],
      sessionId: session.id,
      connectionId: connection.id,
    });
    expect(attached.connectionId).toBe(connection.id);
    expect(attached.status).toBe('connecting');

    const grants = await listActivityGrants(PRINCIPALS[0], connection.id);
    expect(new Set(grants.map((grant) => grant.dataClass))).toEqual(new Set(['metadata']));

    const complete = await updateActivityOnboardingProgress({
      principalId: PRINCIPALS[0],
      sessionId: session.id,
      connectionId: connection.id,
      step: 8,
    });
    expect(complete.status).toBe('complete');
    expect(complete.completedAt).toBeInstanceOf(Date);

    const [stored] = await db
      .select({ status: activityOnboardingSessions.status })
      .from(activityOnboardingSessions)
      .where(eq(activityOnboardingSessions.id, session.id));
    expect(stored.status).toBe('complete');
  });
});
