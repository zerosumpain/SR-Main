/**
 * Does the snapshot actually assemble against real data?
 *
 * The detectors are tested against fabricated snapshots, which proves the rules
 * but not the wiring. This proves the wiring: every source either produces data
 * or says why it did not, and the whole thing survives sources being missing —
 * which on any given day several of them are.
 *
 * Excluded from the merge gate. Run deliberately:
 *   npx vitest run src/lib/daydream/snapshot.integration.test.ts
 *
 * Read-only: it writes nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { buildSnapshot } from './snapshot';
import { DETECTORS } from './detectors';

let dbReady = false;

beforeAll(async () => {
  try {
    await db.select({ id: daydreamTrail.id }).from(daydreamTrail).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
  }
});

describe('buildSnapshot', () => {
  it('assembles, and every source reports what happened to it', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const s = await buildSnapshot();

    expect(s.now).toBeInstanceOf(Date);
    expect(s.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.localDay).toBeGreaterThanOrEqual(0);
    expect(s.localDay).toBeLessThanOrEqual(6);
    expect(s.localHour).toBeGreaterThanOrEqual(0);
    expect(s.localHour).toBeLessThanOrEqual(23);

    // A snapshot that silently lacks a source produces detectors that are
    // silently wrong, so every one of them has to declare itself.
    const keys = s.sources.map((x) => x.key);
    for (const expected of ['trail', 'places', 'calendar', 'memories', 'offers']) {
      expect(keys).toContain(expected);
    }
    for (const src of s.sources) {
      expect(['ok', 'failed', 'empty', 'unavailable']).toContain(src.status);
      expect(src.detail).toBeTruthy();
    }

    // Coverage is a fraction, never a vibe.
    expect(s.coverage.last24h).toBeGreaterThanOrEqual(0);
    expect(s.coverage.last24h).toBeLessThanOrEqual(1);
    expect(s.coverage.last7d).toBeGreaterThanOrEqual(0);
    expect(s.coverage.last7d).toBeLessThanOrEqual(1);

    // `available` is about whether the INDEX EXISTS, not whether it currently
    // holds anything — a read failure reports unavailable, an empty result
    // reports available-and-empty. This used to assert `false` outright with
    // the note "the offer index does not exist until merge 5". Merge 5 landed,
    // the index exists, and the assertion has been failing every nightly since.
    //
    // Asserting the CONTRACT instead of one moment in the build order: whatever
    // `available` says, the source row has to agree with it. That claim stays
    // true whether or not the index is built, which is the point.
    const offerSource = s.sources.find((x) => x.key === 'offers');
    expect(offerSource).toBeTruthy();
    expect(s.offers.available).toBe(offerSource!.status !== 'failed');
    if (!s.offers.available) expect(s.offers.items).toHaveLength(0);
  });

  it('lets every detector judge its own readiness against real data without throwing', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const s = await buildSnapshot();
    for (const d of DETECTORS) {
      const r = d.readiness(s);
      expect(typeof r.ready).toBe('boolean');
      expect(r.reason).toBeTruthy();
      // Whether or not it is ready, running it must not explode.
      expect(() => d.detect(s)).not.toThrow();
    }
  });
});
