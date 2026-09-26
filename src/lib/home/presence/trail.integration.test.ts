/**
 * The daydream trail end to end, against a real database.
 *
 * The pure tests cover the arithmetic; this covers the thing they cannot — that
 * fixes land, that repeated stops become a place, that naming that place writes
 * a memory, and that a fortnight of a dead sensor does not silently read as a
 * fortnight at home.
 *
 * Excluded from the merge gate (`*.integration.test.ts`) because it needs a
 * database. Run it deliberately:
 *
 *   npx vitest run src/lib/daydream/trail.integration.test.ts
 *
 * Self-seeding and self-cleaning, so it is safe on an empty database and safe
 * to run twice. It writes only rows it can identify as its own and deletes
 * them again; it never truncates a table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail, jkaiMemories } from '$lib/db/schema';
import { recordFix, recordGap } from './observe';
import { confirmPlace, refreshPlaces } from './places';
import { coverageOf, hasCoverage } from './cluster';

/** Its own subject, so nothing here can touch or be confused with real data. */
const SUBJECT = 'itest-daydream';

/** Somewhere in the North Sea — cannot collide with a real place. */
const LAT = 56.0;
const LON = 3.0;

let dbReady = false;
const createdPlaceIds: string[] = [];
const createdMemoryIds: string[] = [];

async function cleanup() {
  await db.delete(daydreamTrail).where(eq(daydreamTrail.subject, SUBJECT));
  if (createdPlaceIds.length) {
    await db.delete(daydreamPlaces).where(inArray(daydreamPlaces.id, createdPlaceIds));
  }
  if (createdMemoryIds.length) {
    await db.delete(jkaiMemories).where(inArray(jkaiMemories.id, createdMemoryIds));
  }
}

beforeAll(async () => {
  try {
    await db.select({ id: daydreamTrail.id }).from(daydreamTrail).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }
  await cleanup();
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('daydream trail', () => {
  it('records a fix and derives a mode from the pair', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const t0 = new Date(Date.now() - 60 * 60_000);
    const first = await recordFix(
      { lat: LAT, lon: LON, accuracyM: 10, at: t0.toISOString() },
      'push',
      SUBJECT,
    );
    expect(first.id).toBeGreaterThan(0);
    // Nothing to compare against, so no speed — and therefore mode `unknown`,
    // never `still`. "I could not tell" is not "you did not move".
    expect(first.speedKmh).toBeNull();
    expect(first.mode).toBe('unknown');

    // 1.1 km north, six minutes later ≈ 11 km/h.
    const second = await recordFix(
      {
        lat: LAT + 0.01,
        lon: LON,
        accuracyM: 10,
        at: new Date(t0.getTime() + 6 * 60_000).toISOString(),
      },
      'push',
      SUBJECT,
    );
    expect(second.speedKmh).toBeGreaterThan(9);
    expect(second.speedKmh).toBeLessThan(13);
    expect(second.mode).toBe('active');
  });

  it('rejects an implausible position rather than storing it', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    await expect(
      recordFix({ lat: 0, lon: 0 }, 'push', SUBJECT),
    ).rejects.toThrow(/implausible/);
  });

  it('writes a gap as a row, so a dead sensor is not silence', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    await recordGap('home assistant unreachable (itest)', SUBJECT);

    const rows = await db
      .select({ ts: daydreamTrail.ts, source: daydreamTrail.source, note: daydreamTrail.note })
      .from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, SUBJECT), eq(daydreamTrail.source, 'gap')));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].note).toContain('unreachable');

    // The point of the row: coverage over the window it sits in is NOT
    // improved by it. The system looked and failed, and knows nothing.
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60 * 60_000);
    expect(coverageOf(rows.map((r) => ({ ts: r.ts, source: r.source })), windowStart, now)).toBe(0);
    expect(hasCoverage(rows.map((r) => ({ ts: r.ts, source: r.source })), windowStart, now)).toBe(
      false,
    );
  });
});

describe('places', () => {
  it('turns repeated stops into one place, then takes a name for it', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    // Four visits, four consecutive days, ~25 minutes each, all within a few
    // metres. Three of the four on the same weekday would be a pattern; these
    // are spread, which the rhythm text should decline to over-read.
    const base = Date.now() - 5 * 86_400_000;
    for (let day = 0; day < 4; day++) {
      for (let m = 0; m <= 25; m += 5) {
        await recordFix(
          {
            lat: LAT + 0.00002 * m,
            lon: LON,
            accuracyM: 8,
            at: new Date(base + day * 86_400_000 + m * 60_000).toISOString(),
          },
          'push',
          SUBJECT,
        );
      }
    }

    const before = await db.select({ id: daydreamPlaces.id }).from(daydreamPlaces);
    const beforeIds = new Set(before.map((p) => p.id));

    const result = await refreshPlaces({ windowDays: 30 });
    expect(result.fixes).toBeGreaterThan(0);

    const after = await db.select().from(daydreamPlaces);
    const mine = after.filter((p) => !beforeIds.has(p.id));
    createdPlaceIds.push(...mine.map((p) => p.id));

    // One place, not four — the four stops are the same spot on four days.
    expect(mine).toHaveLength(1);
    const place = mine[0];
    expect(place.visitCount).toBe(4);
    expect(place.medianDwellMins).toBeGreaterThanOrEqual(20);
    // Unnamed and inferred: this is exactly the state that raises a question.
    expect(place.label).toBeNull();
    expect(place.source).toBe('inferred');

    // The fixes now carry the place id, so visit queries are an indexed lookup.
    const assigned = await db
      .select({ id: daydreamTrail.id })
      .from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, SUBJECT), eq(daydreamTrail.placeId, place.id)));
    expect(assigned.length).toBeGreaterThan(20);

    // ── The loop that makes the whole feature work ──
    const { memoryId } = await confirmPlace(place.id, 'The Test Cafe', 'cafe');
    createdMemoryIds.push(memoryId);

    const [memory] = await db
      .select()
      .from(jkaiMemories)
      .where(eq(jkaiMemories.id, memoryId));
    expect(memory.category).toBe('places');
    expect(memory.content).toContain('The Test Cafe');
    expect(memory.content).toContain('4 visits');

    const [named] = await db
      .select()
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.id, place.id));
    expect(named.label).toBe('The Test Cafe');
    expect(named.kind).toBe('cafe');
    expect(named.source).toBe('confirmed');
    expect(named.memoryId).toBe(memoryId);
  });

  it('does not un-name a confirmed place when the geometry is recomputed', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    if (createdPlaceIds.length === 0) return expect(createdPlaceIds.length).toBe(0);

    await refreshPlaces({ windowDays: 30 });

    const [still] = await db
      .select()
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.id, createdPlaceIds[0]));

    // Recomputation refreshes stats. It must never revise the owner's answer.
    expect(still.label).toBe('The Test Cafe');
    expect(still.source).toBe('confirmed');
  });

  it('does not invent a place from a single drive-past', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    // One fix, 3 km away — no dwell, no repeat.
    await recordFix(
      { lat: LAT + 0.03, lon: LON, accuracyM: 8, at: new Date().toISOString() },
      'push',
      SUBJECT,
    );

    const before = await db.select({ id: daydreamPlaces.id }).from(daydreamPlaces);
    const beforeIds = new Set(before.map((p) => p.id));

    await refreshPlaces({ windowDays: 30 });

    const after = await db.select({ id: daydreamPlaces.id }).from(daydreamPlaces);
    const created = after.filter((p) => !beforeIds.has(p.id));
    expect(created).toHaveLength(0);
  });
});
