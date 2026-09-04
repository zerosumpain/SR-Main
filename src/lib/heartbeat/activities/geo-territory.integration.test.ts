// The hourly `geo-territory` activity, against the configured Postgres.
//
// Excluded from `gate:test` by the *.integration.test.ts pattern; included in
// the nightly `gate:test:full`, which runs on a throwaway container. So, like
// the geo service's own integration file, it seeds everything it asserts on and
// scopes every write and every delete to the synthetic `geohb-*` subjects below.
// It
// never truncates a geo table: an empty database is a real state, and one with
// a family's worth of real trail in it must not be disturbed by a test run.
//
// The three properties that matter, in order:
//
//   1. The second invocation is a NO-OP. The activity re-reads a window that
//      overlaps what it has already processed, on purpose, so "run it twice and
//      the ledger is byte-identical" is what stops it inflating every hour.
//   2. The snapshot roll happens INSIDE the hourly run and is not conditional
//      on the ingest having found anything. A daily job with a window would
//      skip forever the first time it missed one (../schedule.ts).
//   3. A subject the ingest is not reaching is REPORTED before its evidence is
//      pruned — spec risk 6, the failure that is otherwise entirely silent.
//
// ── Phases ─────────────────────────────────────────────────────────────────
//
// GEO_HB_PHASE splits the file so a crash can be simulated with a real SIGKILL,
// which is the only honest way to test "killed mid-run leaves no duplicates":
//
//   seed    seed the corpus and stop (no ingest, no cleanup)
//   ingest  invoke the activity once, no seeding, no cleanup  ← kill this one
//   verify  re-invoke, assert nothing is duplicated or lost, then clean up
//   all     (default) everything in one process
//
// In `all` the crash-recovery assertions still run and still mean something:
// they are the same idempotency claim made against a completed run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  appSettings,
  daydreamTrail,
  geoCaptureEvents,
  geoClaims,
  geoDailySnapshot,
  geoTileState,
  type HeartbeatAction,
} from '$lib/db/schema';
import { walk, square } from '$lib/geo/test-fixtures';
import { trailWatermarkKey, writeDailySnapshot, GEO_EPOCH } from '$lib/geo/service';
import { geoTerritory } from './geo-territory';

type Phase = 'seed' | 'ingest' | 'verify' | 'all';
const PHASE = (process.env.GEO_HB_PHASE ?? 'all') as Phase;
const DO_SEED = PHASE === 'seed' || PHASE === 'all';
const DO_MAIN = PHASE === 'all';
const DO_INGEST_ONLY = PHASE === 'ingest';
const DO_VERIFY = PHASE === 'verify' || PHASE === 'all';
const DO_SCRUB = PHASE === 'verify' || PHASE === 'all';

/** Walks a clean 300 m square on the 24th. */
const LOOPER = 'geohb-looper';
/** Walks a clean 300 m square on the 25th, 1.3 km east. */
const STRIDER = 'geohb-strider';
/** Has 85-day-old trail and is deliberately never ingested — the retention
 *  alarm's subject. */
const STALLED = 'geohb-stalled';
/** Named in a config that must still roll snapshots despite finding nothing. */
const ABSENT = 'geohb-absent';

/**
 * Extra walkers, each on their own square. Zero by default — every assertion
 * below holds with the two named ones. The crash phase raises it, because a
 * SIGKILL needs somewhere to land: the two-subject corpus ingests in ~80 ms,
 * which is not an interruption, it is a coin toss. Sixty subjects make the run
 * seconds long and the kill lands in the middle of the writes, which is the
 * state this is trying to prove is recoverable.
 */
const BULK = Math.max(0, Number(process.env.GEO_HB_BULK ?? 0));
const BULK_SUBJECTS = Array.from({ length: BULK }, (_, i) => `geohb-bulk-${i}`);

const SUBJECTS = [LOOPER, STRIDER, STALLED, ABSENT, ...BULK_SUBJECTS];
/** The ones the ingest is actually pointed at. */
const INGESTED = [LOOPER, STRIDER, ...BULK_SUBJECTS];

// Same reasoning as the geo service's integration file: the shared fixture
// origin is Darlington, where John's real runs are, so a synthetic square built
// there would contest real cells and the assertions would depend on what
// happens to be in the database. Same latitude (so the cell size and the
// per-latitude area constant are the real ones), mirrored longitude, which puts
// it in the North Sea where nothing can contest it. Offset again from the geo
// file's own test origin so the two suites cannot collide.
const TEST_ORIGIN = { lat: 54.5236, lon: 1.7536 };

const STEP_M = 150;
const SPEED_MPS = 1.4;
const SIDE = 300;

/**
 * Fixed. Ownership scores decay against `now`, so a run that took the wall
 * clock would write a different `owner_score` every time and could never assert
 * that two runs agree.
 *
 * Chosen so the snapshot roll has work to do: `rollDailySnapshots` never writes
 * today, so the horizon is the 26th, and the loops seeded on the 24th and 25th
 * fall inside it.
 */
const NOW = new Date('2026-08-27T12:00:00.000Z');
const LOOP_DAY = new Date('2026-08-24T09:00:00.000Z');
const STRIDE_DAY = new Date('2026-08-25T09:00:00.000Z');
/** 85 days before NOW — inside the 90-day retention window, and inside the
 *  14-day warn band. This trail is about to be deleted unscored. */
const STALLED_AT = new Date(NOW.getTime() - 85 * 86_400_000);

/** A heartbeat row is required by the context type; nothing in this handler
 *  reads it, and a test that pretended otherwise would be asserting the
 *  engine's shape rather than the activity's. */
const ACTION = { id: 'test', name: 'geo-territory' } as unknown as HeartbeatAction;

function invoke(config: Record<string, unknown>) {
  return geoTerritory.run({ now: NOW.getTime(), config, action: ACTION });
}

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
      claimId: geoCaptureEvents.claimId,
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
      areaM2: geoClaims.areaM2,
      tileCount: geoClaims.tileCount,
      tilesTaken: geoClaims.tilesTaken,
    })
    .from(geoClaims)
    .where(inArray(geoClaims.subject, SUBJECTS))
    .orderBy(geoClaims.subject, geoClaims.sourceRef, geoClaims.ringIndex);

  // `updated_at` is excluded on purpose: a write-time stamp is not state.
  const tiles = await db
    .select({
      tileX: geoTileState.tileX,
      tileY: geoTileState.tileY,
      ownerSubject: geoTileState.ownerSubject,
      ownerScore: geoTileState.ownerScore,
      ownerSince: geoTileState.ownerSince,
      lastEventAt: geoTileState.lastEventAt,
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
  await db.delete(appSettings).where(inArray(appSettings.key, SUBJECTS.map(trailWatermarkKey)));
}

function fixesFor(subject: string, corners: [number, number][], startTs: Date, lonOffset: number) {
  return walk(corners, {
    stepM: STEP_M,
    speedMps: SPEED_MPS,
    startTs,
    accuracyM: 20,
    mode: 'walking',
    origin: { lat: TEST_ORIGIN.lat, lon: TEST_ORIGIN.lon + lonOffset },
  }).map((f) => ({
    ts: f.ts,
    subject,
    // 'backfill', not 'poll'. Four of the five family subjects' history carries
    // this value and it sits outside the obvious allow-list — if a `source`
    // filter ever creeps into the ingest query, this fixture is what fails.
    source: 'backfill',
    lat: f.lat,
    lon: f.lon,
    accuracyM: f.accuracyM ?? null,
    speedKmh: f.speedKmh ?? null,
    mode: f.mode ?? 'walking',
  }));
}

async function seed() {
  await db.insert(daydreamTrail).values([
    ...fixesFor(LOOPER, square(SIDE) as [number, number][], LOOP_DAY, 0),
    ...fixesFor(STRIDER, square(SIDE) as [number, number][], STRIDE_DAY, 0.02),
    // The stalled subject walks the same shape 85 days ago, far to the east.
    // It is real, ingestible ground that nothing is scoring — which is exactly
    // what makes the retention warning a fact rather than a guess.
    ...fixesFor(STALLED, square(SIDE) as [number, number][], STALLED_AT, 0.04),
    // Far enough apart (0.01 deg of longitude is ~647 m at 54.5 deg N) that no
    // two bulk walkers can contest a cell, so the corpus grows without any of
    // the assertions becoming about ownership contests.
    ...BULK_SUBJECTS.flatMap((s, i) =>
      fixesFor(s, square(SIDE) as [number, number][], LOOP_DAY, 0.06 + i * 0.01),
    ),
  ]);
}

beforeAll(async () => {
  if (DO_SEED) {
    await scrub();
    await seed();
  }
}, 60_000);

afterAll(async () => {
  if (DO_SCRUB) await scrub();
}, 60_000);

describe.runIf(DO_SEED)('geo-territory — the corpus', () => {
  it('seeds a trail for every walker but the absent one', async () => {
    // Also the reason this block exists at all: vitest skips a FILE whose every
    // describe is skipped, and a skipped file does not run its top-level
    // beforeAll — so without one live test the `seed` phase silently seeds
    // nothing and the crash run measures an empty database.
    const [row] = await db
      .select({
        fixes: sql<number>`count(*)::int`,
        subjects: sql<number>`count(distinct subject)::int`,
      })
      .from(daydreamTrail)
      .where(inArray(daydreamTrail.subject, SUBJECTS));
    expect(row.subjects).toBe(SUBJECTS.length - 1); // ABSENT has no trail
    expect(row.fixes).toBe(9 * (SUBJECTS.length - 1)); // 9 fixes per square
  });
});

describe.runIf(DO_MAIN)('geo-territory — the hourly ingest', () => {
  let first: Awaited<ReturnType<typeof invoke>>;
  let second: Awaited<ReturnType<typeof invoke>>;
  let afterFirst: StateSnapshot;
  let afterSecond: StateSnapshot;

  beforeAll(async () => {
    // No workouts: this half is about the trail, and the Apple corpus on a real
    // dev box would make "how many events did this run write" depend on what
    // John did last week.
    const cfg = { subjects: INGESTED, includeWorkouts: false, snapshots: false };
    first = await invoke(cfg);
    afterFirst = await readState();
    second = await invoke(cfg);
    afterSecond = await readState();
  }, 120_000);

  it('captures ground on the first invocation', () => {
    expect(first.outcome).toBe('ok');
    const report = (first.details as any).ingest;
    expect(report.totalEventsWritten).toBeGreaterThan(0);
    expect(report.claimsWritten).toBe(INGESTED.length); // one square each
    expect(afterFirst.claims).toHaveLength(INGESTED.length);
    expect(afterFirst.events.length).toBe(report.totalEventsWritten);
  });

  it('advances the watermark past the epoch', async () => {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, INGESTED.map(trailWatermarkKey)));
    expect(rows).toHaveLength(INGESTED.length);
    for (const r of rows) {
      expect(String(r.value)).not.toContain(GEO_EPOCH.slice(0, 4));
      expect(new Date(String(r.value)).getTime()).toBeGreaterThan(LOOP_DAY.getTime() - 86_400_000);
    }
  });

  it('is a NO-OP the second time, with identical event counts', () => {
    const a = (first.details as any).ingest;
    const b = (second.details as any).ingest;
    // Same ground proposed — the watermark overlap guarantees the boundary is
    // re-read — and nothing accepted.
    expect(b.totalEventsProposed).toBe(a.totalEventsProposed);
    expect(b.claimsTotal).toBe(a.claimsTotal);
    expect(b.totalEventsWritten).toBe(0);
    expect(b.claimsWritten).toBe(0);
    expect(afterSecond.events.length).toBe(afterFirst.events.length);
  });

  it('leaves the ledger, the claims and the cells byte-identical', () => {
    expect(afterSecond).toEqual(afterFirst);
  });

  it('reports the subject nothing is ingesting, before its evidence is pruned', () => {
    // Spec risk 6. `geohb-stalled` is never in `subjects`, so its watermark
    // stays at the epoch while its trail ages towards the 90-day cliff. The
    // whole point is that this is visible in the pulse line, not buried.
    const retention = (first.details as any).retention as Array<Record<string, unknown>>;
    const stalled = retention.find((r) => r.subject === STALLED);
    expect(stalled).toBeDefined();
    expect(stalled!.level).toBe('losing');
    expect(stalled!.unreadOldestAgeDays).toBeGreaterThanOrEqual(84);
    expect(first.summary).toContain(`LOSING ${STALLED}`);

    // …and the subjects it IS keeping up with are not in the alarm.
    for (const s of INGESTED) {
      expect(retention.find((r) => r.subject === s)?.level).toBe('ok');
    }
  });

  it('does not turn a retention warning into an error outcome', () => {
    // Deliberate: `error` burns the action's failure budget and eventually
    // PAUSES it, which is the one thing that turns a watermark falling behind
    // into a watermark that never moves again.
    expect(first.outcome).toBe('ok');
    expect(second.outcome).toBe('ok');
    expect(first.costUsd).toBe(0);
  });
});

describe.runIf(DO_MAIN)('geo-territory — the in-run snapshot roll', () => {
  let rolled: Awaited<ReturnType<typeof invoke>>;
  let idle: Awaited<ReturnType<typeof invoke>>;

  beforeAll(async () => {
    rolled = await invoke({ subjects: INGESTED, includeWorkouts: false, snapshots: true });
    // A config pointed at a subject with no trail at all: the ingest finds
    // nothing, and the roll must still have run. This is the property that
    // makes the roll a guarded STEP rather than a consequence of new data.
    idle = await invoke({ subjects: [ABSENT], includeWorkouts: false, snapshots: true });
  }, 120_000);

  it('writes a snapshot row per subject holding ground on the rolled day', async () => {
    // The DAY is rolled explicitly rather than read off whatever the activity's
    // global roll happened to reach.
    //
    // `rollDailySnapshots` picks its start from the whole ledger — the earliest
    // capture event newer than the oldest snapshot, across every subject — and
    // a repair is capped at MAX_SNAPSHOT_REPAIR_DAYS (400). On homeserv, where
    // the real ledger goes back to 2025-06-12, the roll starts there and the cap
    // runs out in July 2026, so it never reaches the synthetic 26th at all and
    // this assertion found an empty array. On the nightly's empty container it
    // starts at the seeded events and does reach it. Same test, two answers,
    // neither of them about the thing being asserted.
    //
    // `writeDailySnapshot` takes the day as an argument, so it is deterministic
    // in both states, and the claim — a row per subject holding ground, and none
    // for a subject holding none — is exactly the one this test was making.
    // That the activity performs a roll at all is covered by the two cases
    // below, which do not depend on where its cursor started.
    await writeDailySnapshot('2026-08-26');

    const snaps = await db
      .select({
        day: geoDailySnapshot.day,
        subject: geoDailySnapshot.subject,
        tileCount: geoDailySnapshot.tileCount,
        areaM2: geoDailySnapshot.areaM2,
      })
      .from(geoDailySnapshot)
      .where(and(eq(geoDailySnapshot.day, '2026-08-26'), inArray(geoDailySnapshot.subject, SUBJECTS)))
      .orderBy(geoDailySnapshot.subject);

    // Both walkers had captured ground by the 26th, and both are on the board.
    expect(snaps.map((s) => s.subject)).toEqual([LOOPER, STRIDER]);
    for (const s of snaps) {
      expect(s.tileCount).toBeGreaterThan(0);
      expect(Number(s.areaM2)).toBeGreaterThan(0);
    }
  });

  it('never snapshots today — a partial day under a final key cannot be detected as wrong', async () => {
    const today = await db
      .select({ day: geoDailySnapshot.day })
      .from(geoDailySnapshot)
      .where(and(eq(geoDailySnapshot.day, '2026-08-27'), inArray(geoDailySnapshot.subject, SUBJECTS)));
    expect(today).toHaveLength(0);
    expect((rolled.details as any).snapshots.days).not.toContain('2026-08-27');
  });

  it('rolls a contiguous run of days, and never past yesterday', () => {
    // What this level can actually assert about the roll.
    //
    // It used to require `days` to contain the 24th and the 26th and
    // `repairedFrom` to be non-null — three claims about a cursor chosen from
    // the WHOLE ledger, by a query that is not scoped to this file's subjects.
    // Both states broke it, in opposite directions: on an empty database there
    // is no older snapshot for anything to be stale against, so `repairedFrom`
    // was null and the nightly went red; on homeserv the real ledger pulls the
    // start back to 2025-06-12 and the 400-day repair cap never arrives at the
    // 26th. It had not passed in either place for a fortnight.
    //
    // The backwards repair IS still proven, deterministically, by
    // `src/lib/geo/service.integration.test.ts` — it snapshots a day, lands a
    // late row on it, and asserts the cursor comes back. That file controls its
    // whole fixture, which is what the claim needs and what this one cannot
    // offer.
    const snap = (rolled.details as any).snapshots;
    expect(Array.isArray(snap.days)).toBe(true);
    expect(snap.rows).toBeGreaterThanOrEqual(0);

    // Contiguous, ascending, and stopping before today — the properties that
    // hold whatever the ledger underneath looks like.
    for (let i = 1; i < snap.days.length; i++) {
      const prev = new Date(`${snap.days[i - 1]}T00:00:00.000Z`).getTime();
      expect(snap.days[i]).toBe(new Date(prev + 86_400_000).toISOString().slice(0, 10));
    }
    for (const day of snap.days) expect(day < '2026-08-27').toBe(true);

    // A repair is not guaranteed here, but if one happened it must have pulled
    // the cursor BACK — never forward past the day it claims to have repaired.
    if (snap.repairedFrom != null) {
      expect(String(snap.repairedFrom)).toBe(String(snap.days[0]));
    }
  });

  it('rolls even when the ingest found nothing at all', () => {
    const report = (idle.details as any).ingest;
    expect(report.subjects).toHaveLength(1);
    expect(report.totalEventsProposed).toBe(0);
    expect(idle.outcome).toBe('ok');
    // The roll ran. It has nothing left to do by now, which is the correct
    // steady state for 23 hours out of every 24 — what matters is that it was
    // ASKED, and that the answer is a report rather than a skip.
    expect((idle.details as any).snapshots).not.toBeNull();
    expect((idle.details as any).snapshotError).toBeNull();
  });
});

describe.runIf(DO_INGEST_ONLY)('geo-territory — one invocation, to be interrupted', () => {
  it('runs the activity (this process is expected to be SIGKILLed)', async () => {
    // Snapshots off: a half-written snapshot series is not what this phase is
    // about, and a bulk corpus dated before the dev box's earliest snapshot
    // would drag a month of unrelated days into the repair.
    const res = await invoke({ subjects: INGESTED, includeWorkouts: true, snapshots: false });
    expect(res.outcome).toBe('ok');
  }, 300_000);
});

describe.runIf(DO_VERIFY)('geo-territory — after an interrupted run', () => {
  let a: Awaited<ReturnType<typeof invoke>>;
  let b: Awaited<ReturnType<typeof invoke>>;
  let stateA: StateSnapshot;
  let stateB: StateSnapshot;

  beforeAll(async () => {
    const cfg = { subjects: INGESTED, includeWorkouts: false, snapshots: false };
    // The first call finishes whatever the killed run left half-done. Watermarks
    // are written LAST by the ingest, so a crash leaves them un-advanced and
    // this call re-reads the whole window.
    a = await invoke(cfg);
    stateA = await readState();
    b = await invoke(cfg);
    stateB = await readState();
  }, 180_000);

  it('has no duplicate ledger rows', async () => {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        distinct: sql<number>`count(distinct (subject, tile_x, tile_y, day, kind))::int`,
      })
      .from(geoCaptureEvents)
      .where(inArray(geoCaptureEvents.subject, SUBJECTS));
    expect(row.total).toBeGreaterThan(0);
    expect(row.total).toBe(row.distinct);
    // And nothing was LOST either. The recovery pass re-read the whole window
    // (the watermarks are written last, so a killed run never advanced them),
    // so what it PROPOSED is the complete ledger for these subjects — stated
    // against the run's own report rather than a hard-coded cell count, which
    // would be a constant about the Mercator grid's phase at one longitude.
    expect(row.total).toBe((a.details as any).ingest.totalEventsProposed);
  });

  it('has no duplicate and no lost claims', () => {
    // One ring per walker, and every one is present however the run was cut
    // short — a claim written before the kill is not re-written, and one the
    // kill prevented is written by the recovery pass.
    expect(stateA.claims).toHaveLength(INGESTED.length);
    expect(new Set(stateA.claims.map((c) => c.subject))).toEqual(new Set(INGESTED));
    for (const c of stateA.claims) expect(Number(c.tileCount)).toBeGreaterThan(0);
  });

  it('stamps every loop event with its claim, including on the recovery pass', () => {
    // The crash window that would show up here: a run killed between writing
    // the claims and writing their events. On the retry the claims already
    // exist, so an insert that only read back the ids it had just inserted
    // would leave the recovered events orphaned.
    const loops = stateA.events.filter((e) => e.kind === 'loop');
    expect(loops.length).toBeGreaterThan(0);
    for (const e of loops) expect(e.claimId).not.toBeNull();
  });

  it('settles: a further invocation writes nothing and changes nothing', () => {
    expect((b.details as any).ingest.totalEventsWritten).toBe(0);
    expect((b.details as any).ingest.claimsWritten).toBe(0);
    expect(stateB).toEqual(stateA);
  });
});
