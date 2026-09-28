/** Explicit isolated-local test. Never uses provider credentials or production data. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail, householdMember } from '$lib/db/schema';
const subject = 'itest-place-insights-20260928';
vi.mock('$lib/integrations/credentials', () => ({ listCredentials: async () => [{ id: 'dummy', createdAt: new Date() }], getCredential: async () => ({ kind: 'apikey', payload: { key: 'pk.synthetic-local-only' } }) }));
vi.mock('./insights.server', () => ({ insightMembers: async () => [{ subject: 'itest-place-insights-20260928', source: 'life360', displayName: 'Synthetic test' }] }));
vi.mock('./geocode.server', async original => ({ ...await original<typeof import('./geocode.server')>(), geocodePendingPlaces: async () => 0 }));
const { discoverRecentStops } = await import('./stops.server');
const { geocodePlace } = await import('./geocode.server');
const { updatePlaceGeometry } = await import('./places');
const enabled = process.env.PRESENCE_LOCAL_TESTS === '1';
const ids: string[] = [];
let id = '';
describe.skipIf(!enabled)('persistent stop discovery and place lookup', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !(/_test$/.test(url.pathname) || url.pathname === '/workflows_jkai_local'
        || process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/strange_rambling')) throw new Error('Only an isolated loopback test database is permitted.');
    await db.insert(householdMember).values({ subject, displayName: 'Synthetic test', source: 'life360' });
    const now = Date.now();
    await db.insert(daydreamTrail).values(Array.from({ length: 6 }, (_, i) => ({ subject, source: 'poll', ts: new Date(now - (5 - i) * 120000), lat: 56.12345, lon: 3.12345, accuracyM: 10, speedKmh: 0, readingAgeS: 0 })));
  });
  afterAll(async () => {
    await db.delete(daydreamTrail).where(eq(daydreamTrail.subject, subject));
    await db.delete(householdMember).where(eq(householdMember.subject, subject));
    if (ids.length) await db.delete(daydreamPlaces).where(inArray(daydreamPlaces.id, ids));
  });
  it('creates a stop during a stay and reuses it on the next tick', async () => {
    expect((await discoverRecentStops()).created).toBe(1);
    const [p] = await db.select().from(daydreamPlaces).where(and(eq(daydreamPlaces.lat, 56.12345), eq(daydreamPlaces.lon, 3.12345)));
    expect(p).toBeDefined(); id = p.id; ids.push(id);
    await db.update(daydreamPlaces).set({ lastSeenAt: new Date(0) }).where(eq(daydreamPlaces.id, id));
    expect((await discoverRecentStops()).created).toBe(0);
    const [reused] = await db.select().from(daydreamPlaces).where(eq(daydreamPlaces.id, id));
    expect(+reused.lastSeenAt!).toBeGreaterThan(Date.now() - 60_000);
    const rows = await db.select().from(daydreamTrail).where(eq(daydreamTrail.subject, subject));
    expect(rows.every(r => r.placeId === id)).toBe(true);
  });
  it('stores a permanent address lookup and avoids repeated provider calls', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
      expect(String(url)).toContain('permanent=true');
      expect(String(url)).toContain('latitude=56.12345');
      const origin = new URL(process.env.PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_SITE_URL?.trim()
        || process.env.ORIGIN?.trim() || 'https://strangeramblings.com').origin;
      expect(new Headers(options?.headers).get('Origin')).toBe(origin);
      expect(new Headers(options?.headers).get('Referer')).toBe(`${origin}/`);
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [3.12345, 56.12345] }, properties: { feature_type: 'address', name: '42 Synthetic Road', full_address: '42 Synthetic Road, Exampletown' } }] }));
    }) as unknown as typeof fetch;
    expect(await geocodePlace(id, fetcher)).toBe(true);
    const [p] = await db.select().from(daydreamPlaces).where(eq(daydreamPlaces.id, id));
    expect(p).toMatchObject({ label: null, source: 'geocoded', suggestedLabel: '42 Synthetic Road', suggestedProvider: 'Mapbox', suggestedPrecision: 'address' });
    expect(await geocodePlace(id, fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('invalidates lookup data after a moved boundary and cools down provider failures', async () => {
    await updatePlaceGeometry(id, { lat: 56.124, lon: 3.124, radiusM: 100 });
    const [p] = await db.select().from(daydreamPlaces).where(eq(daydreamPlaces.id, id));
    expect(p.suggestedLabel).toBeNull(); expect(p.suggestedAt).toBeNull();
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 429 })) as unknown as typeof fetch;
    expect(await geocodePlace(id, fetcher)).toBe(false);
    expect(await geocodePlace(id, fetcher)).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
    const [failed] = await db.select().from(daydreamPlaces).where(eq(daydreamPlaces.id, id));
    expect(failed.suggestedAt).toBeInstanceOf(Date); expect(failed.suggestedLabel).toBeNull();
  });
  it('reads the sampled trail through the real PostgreSQL analysis query', async () => {
    const real = await vi.importActual<typeof import('./insights.server')>('./insights.server');
    const data = await real.loadPresenceInsights({ kind: 'owner' }, 7, subject);
    expect(data.people).toHaveLength(1);
    expect(data.people[0].observed).toBeGreaterThanOrEqual(8);
  });
  it('never overwrites a family-confirmed name', async () => {
    await db.update(daydreamPlaces).set({ label: 'Our name', source: 'confirmed', suggestedAt: null }).where(eq(daydreamPlaces.id, id));
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await geocodePlace(id, fetcher)).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
});
