import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals, activityConnections, activityEvents } from '$lib/db/schema';
import { listActivityEvents } from './events.server';

const principal = 'test-evidence-order';
const connection = 'test-evidence-order-connection';
const ids = ['a', 'b', 'c', 'd', 'e'].map((id) => `${principal}-${id}`);
const day = (n: number) => new Date(`2026-09-${String(n).padStart(2, '0')}T12:00:00Z`);
const cleanup = () => db.delete(activityPrincipals).where(eq(activityPrincipals.id, principal));

beforeAll(async () => {
  await cleanup();
  await db.insert(activityPrincipals).values({ id: principal, kind: 'user', externalRef: principal, label: 'Sort test' });
  await db.insert(activityConnections).values({ id: connection, principalId: principal, provider: 'fixture', mode: 'api_key', label: 'Sort test' });
  await db.insert(activityEvents).values(ids.map((id, i) => ({
    id, eventKey: id, principalId: principal, connectionId: connection,
    source: 'fixture', type: 'test.event', category: 'work', subjectKey: principal,
    occurredAt: [day(1), day(3), null, day(3), day(3)][i],
    observedAt: [day(5), day(2), day(4), day(1), day(1)][i],
    evidenceMode: 'provider_event' as const, actor: {}, object: { kind: 'test' }, measures: {}, provenance: {},
  })));
});
afterAll(cleanup);

describe('evidence ordering in the database', () => {
  it('keeps the existing observed-newest default', async () => {
    expect((await listActivityEvents(principal)).map((row) => row.id)).toEqual([ids[0], ids[2], ids[1], ids[4], ids[3]]);
  });
  it('sorts occurrence before limiting and puts unknown dates last in both directions', async () => {
    expect((await listActivityEvents(principal, { sort: 'occurred', limit: 2 })).map((row) => row.id)).toEqual([ids[4], ids[3]]);
    const rows = await listActivityEvents(principal, { sort: 'occurred', direction: 'asc' });
    expect(rows.map((row) => row.id)).toEqual([ids[0], ids[1], ids[3], ids[4], ids[2]]);
    expect(rows.at(-1)?.occurredAt).toBeNull();
  });
  it('uses the second clock for ties and IDs for stable identical timestamps', async () => {
    expect((await listActivityEvents(principal, { sort: 'occurred', then: 'observed', direction: 'asc' })).map((row) => row.id)).toEqual([ids[0], ids[3], ids[4], ids[1], ids[2]]);
    expect((await listActivityEvents(principal, { sort: 'observed', then: 'occurred', direction: 'asc' })).map((row) => row.id)).toEqual([ids[3], ids[4], ids[1], ids[2], ids[0]]);
  });
  it('retains principal and connection boundaries', async () => {
    expect(await listActivityEvents('another-principal', { sort: 'occurred' })).toEqual([]);
    expect(await listActivityEvents(principal, { connectionIds: ['another-connection'], sort: 'occurred' })).toEqual([]);
  });
});
