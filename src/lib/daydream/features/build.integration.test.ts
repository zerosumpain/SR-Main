/**
 * The feature builder against a real database.
 *
 * The pure tests cover the arithmetic and the day-keying; this covers the thing
 * they cannot — that five tables in four time formats and two scaling
 * conventions actually collapse into rows whose numbers are physiologically
 * possible, and that a day with no reading stores null rather than zero.
 *
 * Excluded from the merge gate (`*.integration.test.ts`). Run it deliberately:
 *
 *   npx vitest run src/lib/daydream/features/build.integration.test.ts
 *
 * It writes only to daydream_day_features, which is derived and disposable by
 * design — every value is recomputed from the sources, so a rebuild is the
 * repair. It never touches a source table.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures } from '$lib/db/schema';
import { buildDayFeatures } from './build';
import { PLAUSIBLE } from './normalise';

let dbReady = false;
let built = 0;

beforeAll(async () => {
  try {
    await db.select({ id: daydreamDayFeatures.id }).from(daydreamDayFeatures).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
  }
  if (!dbReady) return;
  const res = await buildDayFeatures({ windowDays: 365 });
  built = res.written;
}, 120_000);

describe('buildDayFeatures', () => {
  it('produces rows from the real source tables', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    expect(built).toBeGreaterThan(0);
  });

  // The whole point of the exercise. If any of these is out of range, a
  // scaling assumption is wrong and every correlation built on it is fiction.
  it('every stored value is physiologically possible', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const rows = await db.select().from(daydreamDayFeatures);
    const offenders: string[] = [];
    for (const r of rows) {
      const checks: Array<[string, number | null]> = [
        ['steps', r.steps],
        ['meanHeartRate', r.meanHeartRate],
        ['hrvMs', r.hrvMs],
        ['restingHeartRate', r.restingHeartRate],
        ['recoveryScore', r.recoveryScore],
        ['strain', r.strain],
        ['sleepMinutes', r.sleepMinutes],
        ['sleepPerformance', r.sleepPerformance],
        ['activeMinutes', r.activeMinutes],
      ];
      for (const [key, value] of checks) {
        if (value == null) continue;
        const b = PLAUSIBLE[key];
        if (!b) continue;
        if (value < b.lo || value > b.hi) offenders.push(`${r.day} ${key}=${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A day the sensor was off must not look like a day of stillness. This is the
  // distinction that stops an outage being reported as a change in behaviour.
  it('records absence as null and says so in sources', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamDayFeatures)
      .where(sql`${daydreamDayFeatures.sources}->>'trail' = 'absent' and ${daydreamDayFeatures.trailFixes} is not null`);
    expect(row.n).toBe(0);
  });

  it('never stores a zero where it means "not measured"', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamDayFeatures)
      .where(sql`${daydreamDayFeatures.sources}->>'apple' = 'absent' and ${daydreamDayFeatures.steps} = 0`);
    expect(row.n).toBe(0);
  });

  it('is idempotent — rebuilding writes the same day once', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(daydreamDayFeatures);
    await buildDayFeatures({ windowDays: 365 });
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(daydreamDayFeatures);
    expect(after[0].n).toBe(before[0].n);
  }, 120_000);
});
