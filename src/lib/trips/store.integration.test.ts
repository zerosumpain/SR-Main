/**
 * The trip store against the disposable integration database: plan versions
 * are append-only and numbered without gaps, and the phone's events are
 * idempotent on (trip, clientId). Rows are created under a throwaway owner and
 * removed after every case; run only in the hermetic integration lane.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { trip } from '$lib/db/schema';
import { appendPlan, createTrip, deleteTrip, latestPlan, listTrips, recordEvents } from './store.server';

const OWNER = 'itest.trips@example.test';
const plan = { days: [], dropped: [], warnings: [], score: 0 };

afterEach(async () => {
  for (const t of await db.select({ id: trip.id }).from(trip).where(eq(trip.ownerEmail, OWNER))) await deleteTrip(t.id);
});

describe.skipIf(!process.env.DATABASE_URL)('trip store', () => {
  it('appends versions 1, 2, 3 and lists the newest', async () => {
    const t = await createTrip(OWNER, {
      title: 'IT', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-28', pace: 'normal', modes: ['walk'], notes: null,
    });
    const versions = await Promise.all([1, 2, 3].map(() => appendPlan(t.id, { source: 'site', inputHash: 'h', plan, matrix: null, changes: [] })));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
    expect((await latestPlan(t.id))?.version).toBe(3);
    expect((await listTrips(OWNER))[0]).toMatchObject({ id: t.id, planVersion: 3, status: 'planned' });
  });

  it('records each clientId once', async () => {
    const t = await createTrip(OWNER, {
      title: 'IT', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-28', pace: 'normal', modes: ['walk'], notes: null,
    });
    const e = (clientId: string) => ({ clientId, kind: 'arrived' as const, stopId: null, wishId: null, at: '2026-10-27T09:00:00Z', detail: null });
    expect([...(await recordEvents(t.id, [e('a'), e('b')]))].sort()).toEqual(['a', 'b']);
    expect([...(await recordEvents(t.id, [e('b'), e('c')]))]).toEqual(['c']);
  });
});
