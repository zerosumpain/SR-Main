// Exercises the real ingest against the configured Postgres.
//
// Excluded from `gate:test` by the *.integration.test.ts pattern because it
// needs a database; included in the nightly `gate:test:full`, which runs against
// a throwaway container. So it seeds everything it asserts on and cleans up
// after itself — an empty database is a real state, and one with a family's
// worth of real trail in it must not be disturbed by a test run.
//
// The scoping rule this file follows: every write and every delete is keyed on
// the two synthetic subjects below, plus the exact cells they touched. It never
// truncates a geo table.
//
// The single most important assertion here is idempotency. The hourly heartbeat
// re-reads a window that overlaps what it has already processed, on purpose, so
// "run it twice and nothing changes" is not a nicety — it is the property that
// stops the ledger inflating a little bit every hour.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activities,
  activityTracks,
  appSettings,
  daydreamTrail,
  geoCaptureEvents,
  geoClaims,
  geoDailySnapshot,
  geoTileState,
} from '$lib/db/schema';
import { walk, square } from './test-fixtures';
import { tileAt, tileAreaM2 } from './tiles';
import {
  ingestGeoTerritory,
  rollDailySnapshots,
  writeDailySnapshot,
  trailWatermarkKey,
  workoutWatermarkKey,
  WORKOUT_SUBJECT,
  CAPTURING_ACTIVITY_TYPES,
  activityTypeNotIn,
  recomputeTiles,
  resolveFilteredOwnership,
} from './service';

/** A clean loop: 300 m square, anticlockwise, closed exactly. */
const LOOPER = 'geotest-looper';
/** Out 600 m and back along a lane 10 m to the side. Never a claim. */
const WANDERER = 'geotest-wanderer';

const SUBJECTS = [LOOPER, WANDERER];

/**
 * 120 s between fixes — the measured family Life360 polling cadence, which at a
 * 1.4 m/s walk is ~168 m apart.
 *
 * Not an arbitrary choice, and worth stating because it constrains every
 * synthetic fixture in this file: `segmentJourneys` calls a leg MOVING only when
 * the two fixes are more than STILL_RADIUS_M (75 m) apart, so a densely sampled
 * walk — 10 m steps, say — produces NO journey at all and therefore no capture.
 * The trail's own definition of travel is a floor under this feature, in both
 * directions: too slow a cadence and the observation-gap cut severs the path,
 * too fast and the walk reads as somebody standing still.
 */
const STEP_M = 150;
const SPEED_MPS = 1.4;

/**
 * Somewhere nobody has ever walked.
 *
 * The shared fixture ORIGIN is Darlington town centre — the real corpus's own
 * centre of mass — so a synthetic square built there lands on the SAME z19
 * cells as John's actual runs. That is the feature working (the fresher event
 * wins the cell, the older one becomes runner-up), and it is also a test that
 * passes or fails depending on what is in the database it happens to meet.
 * Found the hard way: `runnerUp` came back 'john' on the second pass.
 *
 * Same latitude, so the cell size and the per-latitude area constant are the
 * ones the real feature uses; mirrored longitude, which puts it in the North
 * Sea, where no trail fix and no workout can ever contest it.
 */
const TEST_ORIGIN = { lat: 54.5236, lon: 1.5536 };

/** Fixed, everywhere. Ownership scores decay against `now`, so a test that
 *  took the wall clock would write a different `owner_score` every run and
 *  could never assert that two runs agree. */
const NOW = new Date('2026-08-20T12:00:00.000Z');
/** The horizon for the real-workout case: after every workout in any corpus
 *  this is likely to meet, and still fixed. */
const WORKOUT_NOW = new Date('2026-08-29T00:00:00.000Z');
const LOOP_START = new Date('2026-08-20T09:00:00.000Z');
const OAB_START = new Date('2026-08-20T10:00:00.000Z');

/** Side of the square, metres. 300 m gives ~45 cells and a 150 m ring width. */
const SIDE = 300;

interface StateSnapshot {
  events: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  tiles: Array<Record<string, unknown>>;
}

async function readState(): Promise<StateSnapshot> {
  const events = await db
    .select({
      subject: geoCaptureEvents.subject,
      tileX: geoCaptureEvents.tileX,
      tileY: geoCaptureEvents.tileY,
      day: geoCaptureEvents.day,
      kind: geoCaptureEvents.kind,
      weight: geoCaptureEvents.weight,
      activityType: geoCaptureEvents.activityType,
      capturedAt: geoCaptureEvents.capturedAt,
    })
    .from(geoCaptureEvents)
    .where(inArray(geoCaptureEvents.subject, SUBJECTS))
    .orderBy(
      geoCaptureEvents.subject,
      geoCaptureEvents.kind,
      geoCaptureEvents.tileX,
      geoCaptureEvents.tileY,
    );

  const claims = await db
    .select({
      subject: geoClaims.subject,
      sourceRef: geoClaims.sourceRef,
      ringIndex: geoClaims.ringIndex,
      activityType: geoClaims.activityType,
      areaM2: geoClaims.areaM2,
      capturedAreaM2: geoClaims.capturedAreaM2,
      widthM: geoClaims.widthM,
      tileCount: geoClaims.tileCount,
      tilesTaken: geoClaims.tilesTaken,
      capturedAt: geoClaims.capturedAt,
    })
    .from(geoClaims)
    .where(inArray(geoClaims.subject, SUBJECTS))
    .orderBy(geoClaims.subject, geoClaims.sourceRef, geoClaims.ringIndex);

  // `updated_at` is excluded on purpose: it is a write-time stamp, not state.
  // Everything else must be byte-identical between runs.
  const tiles = await db
    .select({
      tileX: geoTileState.tileX,
      tileY: geoTileState.tileY,
      ownerSubject: geoTileState.ownerSubject,
      ownerScore: geoTileState.ownerScore,
      ownerSince: geoTileState.ownerSince,
      lastEventAt: geoTileState.lastEventAt,
      previousOwner: geoTileState.previousOwner,
      runnerUp: geoTileState.runnerUp,
      runnerUpScore: geoTileState.runnerUpScore,
    })
    .from(geoTileState)
    .where(inArray(geoTileState.ownerSubject, SUBJECTS))
    .orderBy(geoTileState.tileX, geoTileState.tileY);

  return { events, claims, tiles };
}

async function scrub() {
  await db.delete(daydreamTrail).where(inArray(daydreamTrail.subject, SUBJECTS));
  await db.delete(geoClaims).where(inArray(geoClaims.subject, SUBJECTS));
  await db.delete(geoCaptureEvents).where(inArray(geoCaptureEvents.subject, SUBJECTS));
  await db.delete(geoTileState).where(inArray(geoTileState.ownerSubject, SUBJECTS));
  await db.delete(geoDailySnapshot).where(inArray(geoDailySnapshot.subject, SUBJECTS));
  await db
    .delete(appSettings)
    .where(
      inArray(appSettings.key, [
        ...SUBJECTS.map(trailWatermarkKey),
        // The workouts-only case reads the trail for a subject that cannot
        // exist; it still leaves a watermark behind.
        trailWatermarkKey('geotest-absent'),
        workoutWatermarkKey(WORKOUT_SUBJECT),
      ]),
    );
}

async function seed() {
  const loop = walk(square(SIDE), {
    stepM: STEP_M,
    speedMps: SPEED_MPS,
    startTs: LOOP_START,
    accuracyM: 20,
    mode: 'walking',
    origin: TEST_ORIGIN,
  });

  // 600 m out and 600 m back along a lane 10 m to the side of the outbound one.
  // Real shape, real closure (the endpoints are 10 m apart), and it must still
  // produce no claim: the ring is a sliver.
  const outAndBack = walk(
    [
      [0, 0],
      [600, 0],
      [600, 10],
      [0, 10],
    ],
    {
      stepM: STEP_M,
      speedMps: SPEED_MPS,
      startTs: OAB_START,
      accuracyM: 20,
      mode: 'walking',
      // 1.3 km east of the square, so the two subjects never contest a cell
      // and the ownership assertions stay about one thing at a time.
      origin: { lat: TEST_ORIGIN.lat, lon: TEST_ORIGIN.lon + 0.02 },
    },
  );

  await db.insert(daydreamTrail).values([
    ...loop.map((f) => ({
      ts: f.ts,
      subject: LOOPER,
      // 'backfill', not 'poll'. The historical corpus for four of the five
      // family subjects carries this value and it is outside the obvious
      // allow-list — if a `source` filter ever creeps into the ingest query,
      // this fixture is what fails.
      source: 'backfill',
      lat: f.lat,
      lon: f.lon,
      accuracyM: f.accuracyM ?? null,
      speedKmh: f.speedKmh ?? null,
      mode: f.mode ?? 'walking',
    })),
    ...outAndBack.map((f) => ({
      ts: f.ts,
      subject: WANDERER,
      source: 'backfill',
      lat: f.lat,
      lon: f.lon,
      accuracyM: f.accuracyM ?? null,
      speedKmh: f.speedKmh ?? null,
      mode: f.mode ?? 'walking',
    })),
  ]);
}

beforeAll(async () => {
  await scrub();
  await seed();
});

afterAll(async () => {
  if (process.env.GEO_KEEP === '1') return;
  await scrub();
});

describe('geo ingest', () => {
  it('captures a closed loop, tramples an out-and-back, and is idempotent', async () => {
    // ── run one ───────────────────────────────────────────────────────────
    const first = await ingestGeoTerritory({
      subjects: SUBJECTS,
      now: NOW,
      includeWorkouts: false,
    });

    const looper = first.subjects.find((s) => s.subject === LOOPER)!;
    const wanderer = first.subjects.find((s) => s.subject === WANDERER)!;

    expect(looper.fixesRead).toBeGreaterThan(4);
    expect(looper.journeys).toBe(1);
    expect(wanderer.journeys).toBe(1);

    // The loop claims; the sliver does not.
    expect(looper.claims).toBe(1);
    expect(wanderer.claims).toBe(0);

    const after = await readState();

    // A 300 m square: 90,000 m² by the shoelace, which is what a hand-check
    // measures. Within a few percent — the fixture's corners survive sampling,
    // so the only error is the local projection.
    const claim = after.claims[0] as { areaM2: number; widthM: number; tileCount: number };
    expect(after.claims.length).toBe(1);
    expect(claim.areaM2).toBeGreaterThan(SIDE * SIDE * 0.97);
    expect(claim.areaM2).toBeLessThan(SIDE * SIDE * 1.03);
    // 2 x area / perimeter = side / 2 for a square.
    expect(claim.widthM).toBeGreaterThan(SIDE * 0.45);

    // The awarded ground is the cell model, not the shoelace: cells whose
    // CENTROID is inside. It has to be in the same postcode as the ring area
    // without being reconciled with it.
    const cellM2 = tileAreaM2(TEST_ORIGIN.lat);
    expect(claim.tileCount * cellM2).toBeGreaterThan(SIDE * SIDE * 0.7);
    expect(claim.tileCount * cellM2).toBeLessThan(SIDE * SIDE * 1.3);

    // Virgin ground: nobody held these cells before.
    expect((after.claims[0] as { tilesTaken: Record<string, number> }).tilesTaken).toEqual({
      unclaimed: claim.tileCount,
    });

    const loopEvents = after.events.filter((e) => e.subject === LOOPER && e.kind === 'loop');
    const looperTrample = after.events.filter((e) => e.subject === LOOPER && e.kind === 'trample');
    const wandererEvents = after.events.filter((e) => e.subject === WANDERER);

    expect(loopEvents.length).toBe(claim.tileCount);
    expect(loopEvents.every((e) => e.weight === 3)).toBe(true);
    // Ground it walked, as well as ground it enclosed. Both kinds coexist on a
    // cell because `kind` is part of the uniqueness key.
    expect(looperTrample.length).toBeGreaterThan(0);

    // The out-and-back is the whole point of trample being weight 1: it scores,
    // and it never claims.
    expect(wandererEvents.length).toBeGreaterThan(0);
    expect(wandererEvents.every((e) => e.kind === 'trample')).toBe(true);
    expect(wandererEvents.every((e) => e.weight === 1)).toBe(true);

    // Ownership was materialised for the cells that were touched, and the
    // ground is uncontested — the two fixtures are 1.3 km apart in open sea.
    expect(after.tiles.length).toBeGreaterThan(0);
    const home = tileAt(TEST_ORIGIN.lat, TEST_ORIGIN.lon);
    expect(after.tiles.some((t) => t.tileX === home.x && t.tileY === home.y)).toBe(true);
    for (const t of after.tiles) {
      expect(SUBJECTS).toContain(t.ownerSubject);
      expect(t.runnerUp).toBeNull();
      expect(t.previousOwner).toBeNull();
    }

    // ── run two: the assertion this file exists for ───────────────────────
    const second = await ingestGeoTerritory({
      subjects: SUBJECTS,
      now: NOW,
      includeWorkouts: false,
    });

    // The same ground was RE-READ (the watermark overlap guarantees it) and the
    // same geometry re-derived — and nothing new was written.
    expect(second.claimsTotal).toBe(first.claimsTotal);
    expect(second.totalEventsProposed).toBe(first.totalEventsProposed);
    expect(second.claimsWritten).toBe(0);
    expect(second.totalEventsWritten).toBe(0);
    expect(first.claimsWritten).toBe(first.claimsTotal);
    expect(first.totalEventsWritten).toBe(first.totalEventsProposed);

    const again = await readState();
    expect(again.events.length).toBe(after.events.length);
    expect(again.claims.length).toBe(after.claims.length);
    expect(again.tiles.length).toBe(after.tiles.length);
    // Deep equality, not just counts: an ownership recompute that shifted
    // `owner_since` by a run would break the longest-held board silently.
    expect(again.events).toEqual(after.events);
    expect(again.claims).toEqual(after.claims);
    expect(again.tiles).toEqual(after.tiles);
  });

  it('advances the watermark and does not move it backwards', async () => {
    const key = trailWatermarkKey(LOOPER);
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    expect(row).toBeTruthy();
    const mark = new Date(row.value as string);
    // The last fix, not `now` — advancing to the clock would step over data
    // that had not been written yet at the moment the query ran.
    expect(mark.getTime()).toBeGreaterThan(LOOP_START.getTime());
    expect(mark.getTime()).toBeLessThanOrEqual(NOW.getTime());

    // A narrower re-run must not un-advance it.
    await ingestGeoTerritory({ subjects: [LOOPER], now: NOW, includeWorkouts: false });
    const [after] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    expect(new Date(after.value as string).getTime()).toBeGreaterThanOrEqual(mark.getTime());
  });

  it('writes one daily snapshot row per subject and rewrites it identically', async () => {
    const day = '2026-08-20';

    const read = () =>
      db
        .select()
        .from(geoDailySnapshot)
        .where(and(eq(geoDailySnapshot.day, day), inArray(geoDailySnapshot.subject, SUBJECTS)))
        .orderBy(geoDailySnapshot.subject);

    // The day is named rather than discovered, so this case does not depend on
    // what else is in the ledger. rollDailySnapshots' RANGE is exercised below.
    await writeDailySnapshot(day);
    const rows = await read();
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.tileCount).toBeGreaterThan(0);
      expect(r.areaM2).toBeGreaterThan(0);
      // Each fixture is one continuous piece of ground.
      expect(r.regionCount).toBe(1);
    }
    // The looper holds strictly more ground than the wanderer's single lane.
    const byName = new Map(rows.map((r) => [r.subject, r]));
    expect(byName.get(LOOPER)!.tileCount).toBeGreaterThan(byName.get(WANDERER)!.tileCount);

    // Recomputing a day from the same ledger must give the same answer — the
    // whole reason this table exists is that replaying a DECAYED ledger against
    // a later clock does not.
    await writeDailySnapshot(day);
    const rows2 = await read();
    expect(rows2.map((r) => [r.subject, r.tileCount, r.areaM2, r.regionCount])).toEqual(
      rows.map((r) => [r.subject, r.tileCount, r.areaM2, r.regionCount]),
    );
  });

  it('rolls forward only to yesterday, and never writes today', async () => {
    const rolled = await rollDailySnapshots({ now: new Date('2026-08-22T01:00:00Z'), maxDays: 7 });
    // Today is not over. A partial day written under a final day's key is the
    // one row the weekly board cannot detect as wrong.
    expect(rolled.days).not.toContain('2026-08-22');
    for (const d of rolled.days) expect(d <= '2026-08-21').toBe(true);
  });

  /**
   * The Apple half, against whatever workouts the configured database holds.
   *
   * Deliberately does NOT seed and deliberately does NOT clean up — same
   * contract as trails/segments' rebuild.integration.test.ts. The nightly runs
   * this on an empty container, where "no workouts" is a real state and has to
   * produce a coherent empty report rather than an exception; run on a box with
   * a real corpus it proves the two gates that actually matter, on real
   * traces: every foot AND wheeled workout captures with its type recorded, and
   * a second run writes nothing.
   *
   * It writes ledger rows attributed to `john` when workouts exist. That is the
   * feature doing its job and it is idempotent, so it is safe to repeat — which
   * is why nothing here deletes afterwards. A test that DELETED from the ledger
   * would be the dangerous half.
   */
  it('ingests every ground-crossing workout, stamps its type, and repeats as a no-op', async () => {
    const tracked = await db
      .select({
        id: activities.id,
        type: sql<string>`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`,
      })
      .from(activities)
      .innerJoin(activityTracks, eq(activityTracks.activityId, activities.id))
      .where(eq(activities.excludedFromSegments, false));

    // Workouts-only: a subject that cannot exist reads no trail.
    const opts = {
      subjects: ['geotest-absent'],
      includeWorkouts: true,
      full: true,
      now: WORKOUT_NOW,
    };

    const first = await ingestGeoTerritory(opts);
    expect(first.workouts.considered).toBe(tracked.length);

    if (!tracked.length) {
      expect(first.workouts.claims).toBe(0);
      expect(first.workouts.eventsProposed).toBe(0);
      return;
    }

    const eligible = tracked.filter((t) =>
      (CAPTURING_ACTIVITY_TYPES as readonly string[]).includes(t.type),
    );
    // Amendment 1: rides are IN. This is the assertion that used to say the
    // opposite, and it is the point of the whole change.
    expect(CAPTURING_ACTIVITY_TYPES).toContain('ride');
    expect(CAPTURING_ACTIVITY_TYPES).toContain('mtb');
    // Not everything, though: a pool swim's GPS trace is the building.
    expect(CAPTURING_ACTIVITY_TYPES).not.toContain('swim');
    expect(CAPTURING_ACTIVITY_TYPES).not.toContain('other');

    const rows = await db
      .select({
        sourceRef: geoCaptureEvents.sourceRef,
        activityType: geoCaptureEvents.activityType,
      })
      .from(geoCaptureEvents)
      .where(eq(geoCaptureEvents.sourceKind, 'workout'));
    const typeByRef = new Map(rows.map((r) => [r.sourceRef, r.activityType]));

    // Nothing that is not on the allow-list got in...
    for (const ref of typeByRef.keys()) {
      expect(eligible.some((f) => f.id === ref)).toBe(true);
    }
    // ...and every row carries the DECLARED type of the workout it came from,
    // which is the column the map filters on. A ride is recorded as a ride,
    // not silently as a walk and not as null.
    for (const [ref, type] of typeByRef) {
      expect(type).toBe(eligible.find((f) => f.id === ref)!.type);
    }

    const bikes = eligible.filter((t) => t.type === 'ride' || t.type === 'mtb');
    if (bikes.length) {
      // A ride that produced no cell at all would mean the amendment had not
      // landed, and the type assertion above would pass vacuously.
      expect([...typeByRef.values()].some((t) => t === 'ride' || t === 'mtb')).toBe(true);
    }

    const second = await ingestGeoTerritory(opts);
    expect(second.workouts.considered).toBe(first.workouts.considered);
    expect(second.claimsTotal).toBe(first.claimsTotal);
    expect(second.totalEventsProposed).toBe(first.totalEventsProposed);
    expect(second.claimsWritten).toBe(0);
    expect(second.totalEventsWritten).toBe(0);
  });

  it('records the trail as untyped rather than guessing a type for it', async () => {
    // Life360 carries no activity type and `mode` is not a substitute — it
    // derives from GPS speed, which cannot separate a runner from a cyclist.
    // Null is the honest answer and the UI says "untyped".
    const state = await readState();
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.events.every((e) => e.activityType === null)).toBe(true);
    expect(state.claims.every((c) => c.activityType === null)).toBe(true);
  });

  it('never filters the trail by source — a backfill row is the corpus', async () => {
    // The fixtures are all `source: 'backfill'`, so the assertions above already
    // depend on this. Stated as its own case so the reason survives: the column
    // has four values (push | poll | gap | backfill) and `backfill` is the whole
    // historical corpus for four of the five subjects.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamTrail)
      .where(and(inArray(daydreamTrail.subject, SUBJECTS), eq(daydreamTrail.source, 'backfill')));
    expect(n).toBeGreaterThan(0);

    const [{ e }] = await db
      .select({ e: sql<number>`count(*)::int` })
      .from(geoCaptureEvents)
      .where(inArray(geoCaptureEvents.subject, SUBJECTS));
    expect(e).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The brief's hardest requirement, on its own ground.
//
// "If john had a large section of Darlington from a circular run, but katie has
// completed a large number of smaller block walks within, the big section
// should be coloured JK and the smaller sections coloured for katie."
//
// Nothing implements that. It falls out of the decayed argmax: the inner walk
// writes weight-3 events on exactly the cells its ring encloses, and its
// fresher score out-ranks the older single big-loop event THERE and nowhere
// else. Its own subjects, its own origin and its own cells, so it cannot be
// perturbed by, or perturb, the ingest cases above.
// ---------------------------------------------------------------------------

const BIG = 'geotest-big';
const SMALL = 'geotest-small';
const NEST_SUBJECTS = [BIG, SMALL];
/** Further out to sea again. */
const NEST_ORIGIN = { lat: 54.6, lon: 1.9 };
/** The big loop first, the block walk a day later. */
const BIG_START = new Date('2026-08-20T09:00:00.000Z');
const SMALL_START = new Date('2026-08-21T09:00:00.000Z');
const NEST_NOW = new Date('2026-08-21T18:00:00.000Z');

async function nestScrub() {
  await db.delete(daydreamTrail).where(inArray(daydreamTrail.subject, NEST_SUBJECTS));
  await db.delete(geoClaims).where(inArray(geoClaims.subject, NEST_SUBJECTS));
  await db.delete(geoCaptureEvents).where(inArray(geoCaptureEvents.subject, NEST_SUBJECTS));
  await db.delete(geoTileState).where(inArray(geoTileState.ownerSubject, NEST_SUBJECTS));
  await db.delete(geoDailySnapshot).where(inArray(geoDailySnapshot.subject, NEST_SUBJECTS));
  await db.delete(appSettings).where(inArray(appSettings.key, NEST_SUBJECTS.map(trailWatermarkKey)));
}

describe('nesting and handover', () => {
  beforeAll(async () => {
    await nestScrub();

    const outer = walk(square(400), {
      stepM: STEP_M,
      speedMps: SPEED_MPS,
      startTs: BIG_START,
      accuracyM: 20,
      mode: 'walking',
      origin: NEST_ORIGIN,
    });
    // A 160 m block, well inside the 400 m one and a day fresher.
    const inner = walk(square(160, [120, 120]), {
      stepM: STEP_M,
      speedMps: SPEED_MPS,
      startTs: SMALL_START,
      accuracyM: 20,
      mode: 'walking',
      origin: NEST_ORIGIN,
    });

    const row = (subject: string) => (f: (typeof outer)[number]) => ({
      ts: f.ts,
      subject,
      source: 'poll',
      lat: f.lat,
      lon: f.lon,
      accuracyM: f.accuracyM ?? null,
      speedKmh: f.speedKmh ?? null,
      mode: f.mode ?? 'walking',
    });

    await db
      .insert(daydreamTrail)
      .values([...outer.map(row(BIG)), ...inner.map(row(SMALL))]);
  });

  afterAll(async () => {
    if (process.env.GEO_KEEP === '1') return;
    await nestScrub();
  });

  it('punches the inner block through the big loop and records the handover', async () => {
    await ingestGeoTerritory({ subjects: NEST_SUBJECTS, now: NEST_NOW, includeWorkouts: false });

    const tiles = await db
      .select()
      .from(geoTileState)
      .where(inArray(geoTileState.ownerSubject, NEST_SUBJECTS));

    const big = tiles.filter((t) => t.ownerSubject === BIG);
    const small = tiles.filter((t) => t.ownerSubject === SMALL);

    // Both hold ground, and the hole is strictly smaller than the ring round it.
    expect(big.length).toBeGreaterThan(0);
    expect(small.length).toBeGreaterThan(0);
    expect(small.length).toBeLessThan(big.length);

    // The cells that changed hands say so, and they say who from. The ones that
    // never changed hands must NOT — a recompute that stamped `previous_owner`
    // on every row would make the column meaningless.
    const flipped = tiles.filter((t) => t.previousOwner != null);
    expect(flipped.length).toBeGreaterThan(0);
    for (const t of flipped) {
      expect(t.previousOwner).toBe(BIG);
      expect(t.ownerSubject).toBe(SMALL);
      // The loser is still on the board as runner-up, not erased. "Any shape
      // exists until it's been taken over" — the evidence never leaves.
      expect(t.runnerUp).toBe(BIG);
      expect(t.runnerUpScore).toBeGreaterThan(0);
      expect(t.ownerScore).toBeGreaterThan(t.runnerUpScore);
      // Held since the block walk, not since the big loop.
      expect(t.ownerSince.getTime()).toBeGreaterThanOrEqual(SMALL_START.getTime());
    }
    for (const t of big) expect(t.previousOwner).toBeNull();

    // The CLAIM has to tell the same story as the tile state. Both walks arrive
    // in ONE run here — Decision 19's founding land grab, and equally two family
    // members' journeys landing in the same hourly tick — and `tiles_taken` was
    // read off geo_tile_state before anything was written, so every claim in a
    // batch recorded `{"unclaimed": n}` however much ground it had just taken
    // off somebody. Claims are ON CONFLICT DO NOTHING, so no later run repaired
    // it: after the launch backfill the capture feed said every claim landed on
    // virgin land. It is resolved against the ledger now, at the instant before
    // the claim landed.
    const nestClaims = await db
      .select({ subject: geoClaims.subject, tilesTaken: geoClaims.tilesTaken })
      .from(geoClaims)
      .where(inArray(geoClaims.subject, NEST_SUBJECTS));

    const bigClaim = nestClaims.find((c) => c.subject === BIG);
    const smallClaim = nestClaims.find((c) => c.subject === SMALL);
    expect(bigClaim).toBeTruthy();
    expect(smallClaim).toBeTruthy();

    // The big loop got there first, onto ground nobody held.
    expect(Object.keys(bigClaim!.tilesTaken as Record<string, number>)).toEqual(['unclaimed']);
    // The block walk took its cells off BIG, by name, and the count matches the
    // handover geo_tile_state recorded.
    const takenBySmall = smallClaim!.tilesTaken as Record<string, number>;
    expect(takenBySmall[BIG]).toBeGreaterThan(0);
    expect(takenBySmall[BIG]).toBe(flipped.length);
    expect(takenBySmall.unclaimed ?? 0).toBe(0);

    // And a second pass changes nothing — including `previous_owner`, which is
    // the one column a recompute could plausibly rewrite by accident.
    const before = tiles
      .map((t) => `${t.tileX},${t.tileY},${t.ownerSubject},${t.previousOwner},${t.ownerSince.toISOString()}`)
      .sort();
    const report = await ingestGeoTerritory({
      subjects: NEST_SUBJECTS,
      now: NEST_NOW,
      includeWorkouts: false,
    });
    expect(report.totalEventsWritten).toBe(0);
    expect(report.claimsWritten).toBe(0);

    const after = (
      await db.select().from(geoTileState).where(inArray(geoTileState.ownerSubject, NEST_SUBJECTS))
    )
      .map((t) => `${t.tileX},${t.tileY},${t.ownerSubject},${t.previousOwner},${t.ownerSince.toISOString()}`)
      .sort();
    expect(after).toEqual(before);

    // And `tiles_taken` is a pure function of the LEDGER, not of whatever
    // geo_tile_state happened to hold when the claim was written — the same
    // property that keeps `previous_owner` right. Delete the claims and rebuild
    // them from nothing: a contested ring has to name the same victim and the
    // same count. If it were read off the materialised table this would come
    // back `unclaimed`, because a rebuild sees both walks in one batch.
    await db.delete(geoClaims).where(inArray(geoClaims.subject, NEST_SUBJECTS));
    await ingestGeoTerritory({
      subjects: NEST_SUBJECTS,
      now: NEST_NOW,
      full: true,
      includeWorkouts: false,
    });
    const rebuilt = await db
      .select({ subject: geoClaims.subject, tilesTaken: geoClaims.tilesTaken })
      .from(geoClaims)
      .where(inArray(geoClaims.subject, NEST_SUBJECTS));
    expect(rebuilt.find((c) => c.subject === SMALL)!.tilesTaken).toEqual(takenBySmall);
    expect(rebuilt.find((c) => c.subject === BIG)!.tilesTaken).toEqual(bigClaim!.tilesTaken);
  });
});

// ---------------------------------------------------------------------------
// Amendment 1's boundary: cycling counts, driving still does not.
//
// The two halves of the ledger have different gates, and only one of them was
// wired up. `detectLoops` cleans its input, so no drive ever produced a CLAIM;
// `trampledTiles` rasterises exactly what it is handed and honours no accuracy,
// mode or speed gate at all, so the raw fixes the service used to pass it
// painted weight-1 ground down every road a car used. A drive covers a hundred
// times the ground of a walk, so a third of the score per cell is not a
// consolation — it is the fatal failure mode arriving by the side door.
//
// Its own subjects and its own patch of sea, so it can neither perturb nor be
// perturbed by the cases above.
// ---------------------------------------------------------------------------

const DRIVER = 'geotest-driver';
const WALKER = 'geotest-walker';
const DRIVE_SUBJECTS = [DRIVER, WALKER];
const DRIVE_ORIGIN = { lat: 54.7, lon: 2.3 };
const DRIVE_START = new Date('2026-08-20T08:00:00.000Z');
const DRIVE_NOW = new Date('2026-08-20T18:00:00.000Z');

async function driveScrub() {
  await db.delete(daydreamTrail).where(inArray(daydreamTrail.subject, DRIVE_SUBJECTS));
  await db.delete(geoClaims).where(inArray(geoClaims.subject, DRIVE_SUBJECTS));
  await db.delete(geoCaptureEvents).where(inArray(geoCaptureEvents.subject, DRIVE_SUBJECTS));
  await db.delete(geoTileState).where(inArray(geoTileState.ownerSubject, DRIVE_SUBJECTS));
  await db.delete(geoDailySnapshot).where(inArray(geoDailySnapshot.subject, DRIVE_SUBJECTS));
  await db
    .delete(appSettings)
    .where(inArray(appSettings.key, DRIVE_SUBJECTS.map(trailWatermarkKey)));
}

describe('the car gate holds on both halves of the ledger', () => {
  beforeAll(async () => {
    await driveScrub();

    // 4 km round the block at 60 km/h, reported as `vehicle`. Sampled every
    // 250 m, which at 60 km/h is 15 s apart — inside maxInterpolationS and
    // maxInterpolationM, so the rasteriser would happily join every leg.
    const drive = walk(square(1000), {
      stepM: 250,
      speedMps: 60 / 3.6,
      startTs: DRIVE_START,
      accuracyM: 15,
      mode: 'vehicle',
      origin: DRIVE_ORIGIN,
    });

    // A walk on the same ground, so "no events" cannot pass because the fixture
    // itself was unusable.
    const walked = walk(square(300), {
      stepM: STEP_M,
      speedMps: SPEED_MPS,
      startTs: DRIVE_START,
      accuracyM: 20,
      mode: 'walking',
      origin: { lat: DRIVE_ORIGIN.lat, lon: DRIVE_ORIGIN.lon + 0.02 },
    });

    const row = (subject: string) => (f: (typeof drive)[number]) => ({
      ts: f.ts,
      subject,
      source: 'poll',
      lat: f.lat,
      lon: f.lon,
      accuracyM: f.accuracyM ?? null,
      speedKmh: f.speedKmh ?? null,
      mode: f.mode ?? 'walking',
    });

    await db.insert(daydreamTrail).values([...drive.map(row(DRIVER)), ...walked.map(row(WALKER))]);
  });

  afterAll(async () => {
    if (process.env.GEO_KEEP === '1') return;
    await driveScrub();
  });

  it('a drive captures nothing at all — not a claim, and not one trampled cell', async () => {
    await ingestGeoTerritory({ subjects: DRIVE_SUBJECTS, now: DRIVE_NOW, includeWorkouts: false });

    const events = await db
      .select({ subject: geoCaptureEvents.subject, kind: geoCaptureEvents.kind })
      .from(geoCaptureEvents)
      .where(inArray(geoCaptureEvents.subject, DRIVE_SUBJECTS));

    const driver = events.filter((e) => e.subject === DRIVER);
    const walker = events.filter((e) => e.subject === WALKER);

    // The control: the walk on the same ground did score, so a zero for the
    // drive is the gate working rather than the fixture failing to load.
    expect(walker.length).toBeGreaterThan(0);
    expect(walker.some((e) => e.kind === 'trample')).toBe(true);

    // 4 km of road, 16 cells of frontage per kilometre. Zero.
    expect(driver.length).toBe(0);

    const claims = await db
      .select({ subject: geoClaims.subject })
      .from(geoClaims)
      .where(inArray(geoClaims.subject, DRIVE_SUBJECTS));
    expect(claims.filter((c) => c.subject === DRIVER).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Amendment 1, end to end on the Apple corpus: a ride captures, it is stamped
// `ride`, and filtering rides out of the ledger yields a strictly smaller
// territory than not filtering.
//
// Seeds its own two workouts rather than relying on whatever the box holds, so
// the numbers are the same on an empty nightly container as on a developer's
// machine. Cleans up exactly what it created, keyed on ids nothing else can
// use — including the ledger rows, which is the one place in this file where
// deleting is right, because these are synthetic captures, not history.
// ---------------------------------------------------------------------------

const RIDE_ID = 'apple:geotest-ride';
const RUN_ID = 'apple:geotest-run';
const SYNTH_WORKOUTS = [RIDE_ID, RUN_ID];
/** Further out to sea again, and 800 m clear of every other fixture here. */
const FILTER_ORIGIN = { lat: 54.9, lon: 2.9 };
const RIDE_START = new Date('2026-08-24T09:00:00.000Z');
const RUN_START = new Date('2026-08-24T14:00:00.000Z');
const FILTER_NOW = new Date('2026-08-25T00:00:00.000Z');

/** [[lon, lat, elevM, secondsFromStart], …] — activity_tracks' own shape. */
function toCoordinates(fixes: ReturnType<typeof walk>, startTs: Date) {
  return fixes.map((f) => [
    f.lon,
    f.lat,
    null,
    Math.round((f.ts.getTime() - startTs.getTime()) / 1000),
  ]);
}

async function seedWorkout(
  id: string,
  type: string,
  fixes: ReturnType<typeof walk>,
  startTs: Date,
) {
  const start = Math.floor(startTs.getTime() / 1000);
  const end = Math.floor(fixes[fixes.length - 1].ts.getTime() / 1000);
  await db.insert(activities).values({
    id,
    source: 'apple',
    externalId: id.slice('apple:'.length),
    name: `geotest ${type}`,
    activityType: type,
    startDate: start,
    endDate: end,
    startDateLocal: startTs.toISOString(),
    durationS: end - start,
    hasTrack: true,
    excludedFromSegments: false,
  });
  await db.insert(activityTracks).values({
    activityId: id,
    coordinates: toCoordinates(fixes, startTs),
    pointCount: fixes.length,
    bounds: {},
  });
}

async function filterScrub() {
  const tiles = await db
    .select({ tileX: geoCaptureEvents.tileX, tileY: geoCaptureEvents.tileY })
    .from(geoCaptureEvents)
    .where(inArray(geoCaptureEvents.sourceRef, SYNTH_WORKOUTS));

  await db.delete(geoCaptureEvents).where(inArray(geoCaptureEvents.sourceRef, SYNTH_WORKOUTS));
  await db.delete(geoClaims).where(inArray(geoClaims.sourceRef, SYNTH_WORKOUTS));
  // Only the cells these synthetic workouts touched, and only if nothing real
  // is left on them. Never a blanket delete of john's tile state.
  for (const t of tiles) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(geoCaptureEvents)
      .where(and(eq(geoCaptureEvents.tileX, t.tileX), eq(geoCaptureEvents.tileY, t.tileY)));
    if (n === 0) {
      await db
        .delete(geoTileState)
        .where(and(eq(geoTileState.tileX, t.tileX), eq(geoTileState.tileY, t.tileY)));
    }
  }
  // activity_tracks cascades on the activity delete.
  await db.delete(activities).where(inArray(activities.id, SYNTH_WORKOUTS));
}

describe('a ride captures, carries its type, and can be filtered back out', () => {
  beforeAll(async () => {
    await filterScrub();

    // 18 km/h — a real ride pace, and under the 25 km/h car ceiling, so the
    // gate that stops a drive does not also stop a bike.
    const ride = walk(square(800), {
      stepM: 50,
      speedMps: 5,
      startTs: RIDE_START,
      origin: FILTER_ORIGIN,
    });
    // A foot loop on ground the ride never touches, so the filtered territory
    // is non-empty and the comparison is about the ride, not about everything.
    const run = walk(square(300, [2000, 2000]), {
      stepM: 30,
      speedMps: 2.8,
      startTs: RUN_START,
      origin: FILTER_ORIGIN,
    });

    await seedWorkout(RIDE_ID, 'ride', ride, RIDE_START);
    await seedWorkout(RUN_ID, 'run', run, RUN_START);
  });

  afterAll(async () => {
    if (process.env.GEO_KEEP === '1') return;
    await filterScrub();
  });

  it('captures the ride and stamps every row `ride`', async () => {
    await ingestGeoTerritory({
      subjects: ['geotest-absent'],
      includeWorkouts: true,
      full: true,
      now: FILTER_NOW,
    });

    const events = await db
      .select({
        sourceRef: geoCaptureEvents.sourceRef,
        kind: geoCaptureEvents.kind,
        activityType: geoCaptureEvents.activityType,
        tileX: geoCaptureEvents.tileX,
        tileY: geoCaptureEvents.tileY,
      })
      .from(geoCaptureEvents)
      .where(inArray(geoCaptureEvents.sourceRef, SYNTH_WORKOUTS));

    const rideEvents = events.filter((e) => e.sourceRef === RIDE_ID);
    const runEvents = events.filter((e) => e.sourceRef === RUN_ID);

    // The reversal of Decision 7, stated as a number: before Amendment 1 this
    // was zero.
    expect(rideEvents.length).toBeGreaterThan(0);
    expect(rideEvents.some((e) => e.kind === 'loop')).toBe(true);
    expect(runEvents.length).toBeGreaterThan(0);

    // Every row knows what it was, which is what "filterable" needs.
    expect(rideEvents.every((e) => e.activityType === 'ride')).toBe(true);
    expect(runEvents.every((e) => e.activityType === 'run')).toBe(true);

    const [claim] = await db
      .select({ activityType: geoClaims.activityType, tileCount: geoClaims.tileCount })
      .from(geoClaims)
      .where(eq(geoClaims.sourceRef, RIDE_ID));
    expect(claim).toBeTruthy();
    expect(claim.activityType).toBe('ride');
    expect(claim.tileCount).toBeGreaterThan(0);
  });

  it('filtering rides out yields a strictly smaller territory', async () => {
    const distinctTiles = async (excludeRides: boolean) => {
      const rows = await db
        .selectDistinct({ tileX: geoCaptureEvents.tileX, tileY: geoCaptureEvents.tileY })
        .from(geoCaptureEvents)
        .where(
          excludeRides
            ? and(
                inArray(geoCaptureEvents.sourceRef, SYNTH_WORKOUTS),
                sql`${geoCaptureEvents.activityType} is distinct from 'ride'`,
              )
            : inArray(geoCaptureEvents.sourceRef, SYNTH_WORKOUTS),
        );
      return rows.length;
    };

    const all = await distinctTiles(false);
    const onFoot = await distinctTiles(true);

    expect(all).toBeGreaterThan(0);
    expect(onFoot).toBeGreaterThan(0);
    // Smaller, not empty: the run's ground survives, the ride's does not.
    expect(onFoot).toBeLessThan(all);

    // And the filter is applied at the READ. Nothing was re-ingested, no
    // watermark moved, and the ride's rows are still there to be unfiltered.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(geoCaptureEvents)
      .where(eq(geoCaptureEvents.activityType, 'ride'));
    expect(n).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The weekly board's honesty: a snapshot has to be repairable.
//
// rollDailySnapshots used to move only FORWARD from the newest snapshot day
// (`startDay = latest.day + 1`), so ground that arrived for a day already
// snapshotted was permanently missing from the gained/lost board and no exposed
// call could repair it — POST /api/geo/rebuild took no day, and
// writeDailySnapshot was reachable from no route, so the only fix was a manual
// DELETE in psql. Which is exactly Phase 5: merge, backfill katie/fintan/
// jemima/rory, rebuild. The rebuild repairs the ledger and geo_tile_state and
// not one snapshot row, so the board would read as though John owned everything
// for the whole founding week, forever. The ordinary case is the same shape: a
// Life360 `gap` or `backfill` fix landing on a day the heartbeat has rolled
// past.
//
// The roll writes rows for every subject holding ground on the days it covers,
// so this case is not scoped to its own subjects the way the rest of the file
// is — it cannot be, because that is what it is testing. It deletes only its
// own two subjects' rows afterwards; the rest are recomputable from the ledger
// by construction, which is the property under test.
// ---------------------------------------------------------------------------

const EARLY = 'geotest-early';
const LATE = 'geotest-late';
const REPAIR_SUBJECTS = [EARLY, LATE];
/** After every other fixture's day in this file, so the roll reaches it. */
const REPAIR_DAY = '2026-08-26';
const REPAIR_NOW = new Date('2026-08-28T06:00:00.000Z');

async function repairScrub() {
  await db.delete(geoCaptureEvents).where(inArray(geoCaptureEvents.subject, REPAIR_SUBJECTS));
  await db.delete(geoDailySnapshot).where(inArray(geoDailySnapshot.subject, REPAIR_SUBJECTS));
  await db.delete(geoTileState).where(inArray(geoTileState.ownerSubject, REPAIR_SUBJECTS));
}

/** One synthetic ledger row on a cell nothing else can reach. */
function repairEvent(subject: string, tileX: number, at: string) {
  return {
    subject,
    tileX,
    tileY: 991_001,
    day: at.slice(0, 10),
    kind: 'loop' as const,
    weight: 3,
    capturedAt: new Date(at),
    sourceKind: 'trail',
    sourceRef: `${subject}@repair`,
    activityType: null,
  };
}

describe('a snapshotted day can be repaired when the ledger moves under it', () => {
  beforeAll(repairScrub);
  afterAll(async () => {
    if (process.env.GEO_KEEP === '1') return;
    await repairScrub();
  });

  it('reopens the day a late row landed on, and reaches it again on the next roll', async () => {
    // The day happens, and the heartbeat snapshots it.
    await db.insert(geoCaptureEvents).values([
      repairEvent(EARLY, 991_001, `${REPAIR_DAY}T09:00:00.000Z`),
    ]);
    const first = await writeDailySnapshot(REPAIR_DAY);
    expect(first.some((r) => r.subject === EARLY)).toBe(true);

    // Then the backfill arrives, for the SAME day, after the snapshot exists.
    await db.insert(geoCaptureEvents).values([
      repairEvent(LATE, 991_002, `${REPAIR_DAY}T10:00:00.000Z`),
    ]);

    // Before the fix this returned {"days":[],"rows":0} — the day was behind
    // the cursor and nothing could bring it back.
    //
    // maxDays is deliberately 1 here. A repair is NOT capped by it, because a
    // half-done repair makes no progress at all: the days it did not reach keep
    // their old created_at, the same late row is still late relative to them,
    // and the next call recomputes the identical range forever.
    const rolled = await rollDailySnapshots({ now: REPAIR_NOW, maxDays: 1 });
    expect(rolled.days.length).toBeGreaterThan(1);
    expect(rolled.days[rolled.days.length - 1]).toBe('2026-08-27');
    expect(rolled.days).toContain(REPAIR_DAY);
    // A repair, not a forward roll: the cursor was pulled BACK to a day that
    // already had rows.
    expect(rolled.repairedFrom).not.toBeNull();
    expect(rolled.repairedFrom! <= REPAIR_DAY).toBe(true);

    const after = await db
      .select()
      .from(geoDailySnapshot)
      .where(
        and(eq(geoDailySnapshot.day, REPAIR_DAY), inArray(geoDailySnapshot.subject, REPAIR_SUBJECTS)),
      );
    // Both subjects now hold their ground on the day they demonstrably owned it.
    expect(after.map((r) => r.subject).sort()).toEqual([EARLY, LATE]);

    // Repaired means repaired: nothing is stale any more, so the next roll is a
    // plain forward roll. That is also what makes progress guaranteed when
    // `maxDays` is smaller than the repair — writeDailySnapshot refreshes
    // created_at, so a day this call fixed does not come back next call and the
    // cursor cannot sit still.
    const again = await rollDailySnapshots({ now: REPAIR_NOW, maxDays: 400 });
    expect(again.repairedFrom).toBeNull();
  }, 120_000);

  it('drops a subject whose repaired day no longer belongs to them', async () => {
    // ABSENCE MEANS ZERO in both directions. A repair can take a subject's last
    // cell off them, and an upsert alone leaves the old row standing as a ghost
    // the weekly board reads as ground still held.
    await repairScrub();
    await db
      .insert(geoDailySnapshot)
      .values({ day: REPAIR_DAY, subject: LATE, tileCount: 99, areaM2: 1, regionCount: 1 });

    await writeDailySnapshot(REPAIR_DAY);

    const ghost = await db
      .select()
      .from(geoDailySnapshot)
      .where(and(eq(geoDailySnapshot.day, REPAIR_DAY), eq(geoDailySnapshot.subject, LATE)));
    expect(ghost.length).toBe(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Amendment 1's other half: the filter has to move the MAP, not just the list.
//
// activity_type made the cell list filterable and left ownership resolved over
// the unfiltered ledger, so a foot-only view kept cells whose materialised owner
// had earned them by bike alone. And the natural way to spell the filter is a
// silent data-loss bug: this column is NULL for every trail journey, and
// `null not in ('ride')` is NULL rather than true, so a bare NOT IN deletes the
// whole Life360 corpus — four of the five subjects — while John's typed Apple
// rows survive and the map reads as four broken phones.
//
// Neither was caught by the corpus this amendment was measured on, because that
// corpus contains no untyped rows at all. So this case seeds one.
// ---------------------------------------------------------------------------

const RIDER = 'geotest-rider';
const FOOT = 'geotest-foot';
const FILTER_SUBJECTS = [RIDER, FOOT];
const FILTER_TILE = { x: 992_001, y: 992_001 };
const FILTER_HORIZON = new Date('2026-08-29T00:00:00.000Z');

async function typeFilterScrub() {
  await db.delete(geoCaptureEvents).where(inArray(geoCaptureEvents.subject, FILTER_SUBJECTS));
  await db.delete(geoTileState).where(inArray(geoTileState.ownerSubject, FILTER_SUBJECTS));
  await db.delete(geoDailySnapshot).where(inArray(geoDailySnapshot.subject, FILTER_SUBJECTS));
}

describe('the activity filter moves ownership, and never eats the untyped corpus', () => {
  beforeAll(async () => {
    await typeFilterScrub();
    await db.insert(geoCaptureEvents).values([
      // A ride loop: weight 3, typed.
      {
        subject: RIDER,
        tileX: FILTER_TILE.x,
        tileY: FILTER_TILE.y,
        day: '2026-08-26',
        kind: 'loop',
        weight: 3,
        capturedAt: new Date('2026-08-26T09:00:00.000Z'),
        sourceKind: 'workout',
        sourceRef: 'apple:geotest-typefilter-ride',
        activityType: 'ride',
      },
      // A trail trample on the same cell: weight 1, and UNTYPED, because
      // Life360 carries no activity type. This is the row the bare NOT IN
      // deletes.
      {
        subject: FOOT,
        tileX: FILTER_TILE.x,
        tileY: FILTER_TILE.y,
        day: '2026-08-27',
        kind: 'trample',
        weight: 1,
        capturedAt: new Date('2026-08-27T09:00:00.000Z'),
        sourceKind: 'trail',
        sourceRef: `${FOOT}@typefilter`,
        activityType: null,
      },
    ]);
  });

  afterAll(async () => {
    if (process.env.GEO_KEEP === '1') return;
    await typeFilterScrub();
  });

  it('a bare NOT IN drops the untyped row; the exported helper keeps it', async () => {
    const cell = and(
      eq(geoCaptureEvents.tileX, FILTER_TILE.x),
      eq(geoCaptureEvents.tileY, FILTER_TILE.y),
    );

    const bare = await db
      .select({ subject: geoCaptureEvents.subject })
      .from(geoCaptureEvents)
      .where(and(cell, sql`${geoCaptureEvents.activityType} not in ('ride', 'mtb')`));
    // The trail row is gone. Not filtered out — three-valued logic ate it.
    expect(bare.length).toBe(0);

    const safe = await db
      .select({ subject: geoCaptureEvents.subject })
      .from(geoCaptureEvents)
      .where(and(cell, activityTypeNotIn(geoCaptureEvents.activityType, ['ride', 'mtb'])));
    expect(safe.map((r) => r.subject)).toEqual([FOOT]);

    // And the one-value form, which is the other way to get it right.
    const single = await db
      .select({ subject: geoCaptureEvents.subject })
      .from(geoCaptureEvents)
      .where(and(cell, activityTypeNotIn(geoCaptureEvents.activityType, ['ride'])));
    expect(single.map((r) => r.subject)).toEqual([FOOT]);
  }, 120_000);

  it('the materialised owner is the rider; the foot-only owner is the walker', async () => {
    await recomputeTiles([FILTER_TILE], FILTER_HORIZON);

    const [state] = await db
      .select()
      .from(geoTileState)
      .where(
        and(eq(geoTileState.tileX, FILTER_TILE.x), eq(geoTileState.tileY, FILTER_TILE.y)),
      );
    // Unfiltered, the cell is the rider's — 3 x decay beats 1 x decay.
    expect(state.ownerSubject).toBe(RIDER);
    expect(state.runnerUp).toBe(FOOT);

    // Under the filter the amendment exists for, the SAME cell is the walker's.
    // A page that took its cells from the ledger under this filter and its
    // colours from geo_tile_state would paint the rider's colour on a walking
    // map: two questions that disagree. This is the one question.
    const filtered = await resolveFilteredOwnership({
      now: FILTER_HORIZON,
      filter: { excludeActivityTypes: ['ride', 'mtb'] },
      tiles: [FILTER_TILE],
    });
    const owned = [...filtered.values()];
    expect(owned.length).toBe(1);
    expect(owned[0].owner).toBe(FOOT);
    expect(owned[0].runnerUp).toBeNull();

    // With no filter it agrees with the materialised table, so a caller can use
    // geo_tile_state for the default view and this for every other one.
    const unfiltered = await resolveFilteredOwnership({
      now: FILTER_HORIZON,
      tiles: [FILTER_TILE],
    });
    expect([...unfiltered.values()][0].owner).toBe(RIDER);

    // Excluding rides must not also exclude the untyped trail corpus: the cell
    // still has an owner. That is the assertion the ride/run corpus could never
    // make, because it holds no untyped rows.
    expect(filtered.size).toBe(1);
  }, 120_000);
});
