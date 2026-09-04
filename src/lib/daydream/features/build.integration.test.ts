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
import {
  activities,
  appleHealthMetrics,
  daydreamDayFeatures,
  daydreamSpend,
  daydreamTrail,
  whoopCycles,
  whoopRecovery,
  whoopSleep,
} from '$lib/db/schema';
import { buildDayFeatures } from './build';
import { PLAUSIBLE } from './normalise';

let dbReady = false;
/**
 * Whether any of the tables `buildDayFeatures` reads has a row in it.
 *
 * `dbReady` alone was the guard, and it only ever asked "can I reach the
 * features table". On homeserv that is the same question as "is there data",
 * because the dev database has years of it. On the nightly's freshly-created
 * container the table exists and is empty, so `dbReady` was true, the build
 * wrote nothing, and `expect(built).toBeGreaterThan(0)` failed every night
 * from 2026-08-19.
 *
 * An empty database is a REAL state — it is what production looked like
 * before the first sync — so the zero is asserted rather than skipped.
 */
let hasSources = false;
let built = 0;

/** The tables `build.ts` actually reads. Listed rather than inferred: if the
 *  builder gains a source, this guard has to gain it too, and a missing entry
 *  shows up as a test that quietly stops asserting anything. */
const SOURCE_TABLES = [
  activities,
  appleHealthMetrics,
  daydreamSpend,
  daydreamTrail,
  whoopCycles,
  whoopRecovery,
  whoopSleep,
];

beforeAll(async () => {
  try {
    await db.select({ id: daydreamDayFeatures.id }).from(daydreamDayFeatures).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
  }
  if (!dbReady) return;
  for (const t of SOURCE_TABLES) {
    const [row] = await db.select({ one: sql<number>`1` }).from(t).limit(1);
    if (row) {
      hasSources = true;
      break;
    }
  }
  const res = await buildDayFeatures({ windowDays: 365 });
  built = res.written;
}, 120_000);

describe('buildDayFeatures', () => {
  it('produces rows from the real source tables', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    // No sources is a coherent zero, not an exception: the builder must write
    // nothing rather than throw or invent a row.
    if (!hasSources) return expect(built).toBe(0);
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

/**
 * Whose data ends up in whose row.
 *
 * Whoop, Apple Health, `daydream_spend` and the calendar have no subject
 * column — there is one owner and every row is his. The trail is the only
 * genuinely per-person domain. Building a day for anybody else must therefore
 * leave the owner-only domains ABSENT, or a row for Katie carries John's sleep
 * score under her name and every correlation drawn from it is a confident
 * statement about the wrong person.
 *
 * This is the test for that, and it is an integration test because the gate
 * lives inside the query layer it protects.
 */
describe('owner-only domains', () => {
  it('never writes the owner’s health, spend or diary into another subject’s row', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const res = await buildDayFeatures({ windowDays: 30, subject: 'katie' });
    // With no sources there is no row to inspect, and the leak this test
    // guards cannot happen — but the builder still has to come back with a
    // coherent zero rather than throwing, which is worth asserting on its own.
    if (!hasSources) {
      expect(res.days).toBe(0);
      return;
    }
    // The trail is hers, so there should be something to build from at all.
    // If there is not, the assertion below is vacuous and worth knowing about.
    expect(res.days).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(daydreamDayFeatures)
      .where(sql`${daydreamDayFeatures.subject} = 'katie'`);
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      const sources = (r.sources ?? {}) as Record<string, string>;
      for (const domain of ['whoop', 'apple', 'calendar', 'spend']) {
        if (sources[domain] !== undefined) {
          expect(sources[domain]).toBe('absent');
        }
      }
      // Belt and braces on the columns themselves: an absent domain that
      // somehow wrote a value is the failure this exists to catch.
      expect(r.sleepPerformance).toBeNull();
      expect(r.strain).toBeNull();
      expect(r.verifiedSpendMinor).toBeNull();
      expect(r.calendarEvents).toBeNull();
    }
  }, 120_000);
});
