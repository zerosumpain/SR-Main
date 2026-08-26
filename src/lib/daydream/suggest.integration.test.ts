/**
 * The naming queue and the reconciler, against a real database.
 *
 * Both exist to fix a production failure that the pure tests cannot reach:
 *
 *   • 78 unnamed places, none past the three-visit ask threshold, so the naming
 *     panel rendered nothing at all while seven detectors waited on names.
 *   • Six thoughts still asking "what is this place?" about places that had
 *     been named hours earlier.
 *
 * Excluded from the merge gate (`*.integration.test.ts`) because it needs a
 * database. Run it deliberately:
 *
 *   npx vitest run src/lib/daydream/suggest.integration.test.ts
 *
 * Self-seeding and self-cleaning: it writes only rows it can identify as its
 * own and deletes them again, and never truncates a table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamThoughts } from '$lib/db/schema';
import { listNamingQueue, reconcileNamedPlaceThoughts } from './places';
import { placesNeedingSuggestion } from './suggest';

/** Somewhere in the North Sea — cannot collide with a real place. */
const LAT = 56.5;
const LON = 3.5;

let dbReady = false;
const placeIds: string[] = [];
const thoughtIds: string[] = [];

async function cleanup() {
  if (thoughtIds.length) {
    await db.delete(daydreamThoughts).where(inArray(daydreamThoughts.id, thoughtIds));
  }
  if (placeIds.length) {
    await db.delete(daydreamPlaces).where(inArray(daydreamPlaces.id, placeIds));
  }
}

beforeAll(async () => {
  try {
    await db.select({ id: daydreamPlaces.id }).from(daydreamPlaces).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
  }
  if (!dbReady) return;

  // One place with a single visit — the shape that made the panel render
  // empty, because MIN_VISITS_TO_ASK is 3.
  const [quiet] = await db
    .insert(daydreamPlaces)
    .values({
      lat: LAT, lon: LON, radiusM: 200, visitCount: 1, medianDwellMins: 20,
      dayHistogram: [1, 0, 0, 0, 0, 0, 0], hourHistogram: new Array(24).fill(0),
      status: 'active', source: 'inferred',
    })
    .returning({ id: daydreamPlaces.id });
  placeIds.push(quiet.id);

  // One already named, with an open question still attached to it.
  const [named] = await db
    .insert(daydreamPlaces)
    .values({
      lat: LAT + 0.01, lon: LON, radiusM: 200, visitCount: 6, medianDwellMins: 30,
      label: 'The Test Chippy', kind: 'shop', source: 'confirmed',
      dayHistogram: [2, 0, 0, 0, 0, 0, 0], hourHistogram: new Array(24).fill(0),
      status: 'active',
    })
    .returning({ id: daydreamPlaces.id });
  placeIds.push(named.id);

  const [stale] = await db
    .insert(daydreamThoughts)
    .values({
      kind: 'unknown_place',
      title: 'What is this place you keep going to?',
      explanation: 'seeded by the integration test',
      score: 0.5, components: {}, evidence: [], proposedActions: [],
      placeId: named.id,
      dedupeKey: `itest:unknown_place:${named.id}`,
      status: 'suppressed',
    })
    .returning({ id: daydreamThoughts.id });
  thoughtIds.push(stale.id);
});

afterAll(cleanup);

describe('listNamingQueue', () => {
  // The regression this guards: gating the queue on MIN_VISITS_TO_ASK meant a
  // one-visit place was invisible, and with 68 of 83 places at one visit the
  // panel showed an empty state while the bottleneck it existed to clear sat
  // right behind it.
  it('includes a place with a single visit', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const queue = await listNamingQueue(200);
    const ids = queue.map((q) => q.id);
    expect(ids).toContain(placeIds[0]);
  });

  it('excludes a place that already has a name', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const queue = await listNamingQueue(200);
    expect(queue.map((q) => q.id)).not.toContain(placeIds[1]);
  });
});

describe('placesNeedingSuggestion', () => {
  it('offers an unnamed, never-asked place', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const queue = await placesNeedingSuggestion(200);
    expect(queue.map((q) => q.id)).toContain(placeIds[0]);
  });

  // A place that has already been asked about must not come round again on the
  // next run, or the queue never drains past its first batch.
  it('skips a place already stamped, even when the answer was blank', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    await db
      .update(daydreamPlaces)
      .set({ suggestedLabel: null, suggestedAt: new Date() })
      .where(eq(daydreamPlaces.id, placeIds[0]));

    const queue = await placesNeedingSuggestion(200);
    expect(queue.map((q) => q.id)).not.toContain(placeIds[0]);
  });
});

describe('reconcileNamedPlaceThoughts', () => {
  // The production symptom: six thoughts reading "What is this place you keep
  // going to?" about places named hours earlier. `confirmPlace` closes the one
  // it just named; this closes whatever any other path left standing.
  it('closes an open question about a place that now has a name', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const closed = await reconcileNamedPlaceThoughts();
    expect(closed).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select({ status: daydreamThoughts.status })
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.id, thoughtIds[0]));
    expect(row.status).toBe('actioned');
  });

  it('is idempotent — a second run closes nothing new', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const first = await reconcileNamedPlaceThoughts();
    expect(first).toBe(0);
  });
});
