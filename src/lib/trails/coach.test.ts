import { describe, it, expect } from 'vitest';
import {
  applyProgression,
  efTrendPct,
  fitScore,
  gapScore,
  neglectedSport,
  rankGettableSegments,
  stalenessScore,
  strongerSport,
  trustScore,
  usableAcwr,
  usableMonotony,
  type BaseProposal,
  type GettableCandidate,
  type TrainingState,
} from './coach';
import type { ACWRResult } from '$lib/health/analytics/acwr';
import type { MonotonyResult } from '$lib/health/analytics/monotony';
import type { PolarisedResult } from '$lib/health/analytics/polarised';
import type { MetricResult, Sufficiency } from '$lib/health/analytics/types';

// ——— Builders ————————————————————————————————————————————————————————
//
// The insufficient cases are built EXACTLY as the analytics build them —
// a fully-populated zero struct, not a null — because that is the trap.

function metric<T>(value: T, sufficiency: Sufficiency = 'ok', sampleSize = 42): MetricResult<T> {
  return { value, sufficiency, asOf: '2026-08-21T00:00:00.000Z', sampleSize };
}

function acwr(ratio: number): MetricResult<ACWRResult> {
  const zone: ACWRResult['zone'] =
    ratio < 0.5 ? 'detraining' : ratio < 0.8 ? 'undertraining' : ratio <= 1.3 ? 'optimal' : ratio <= 1.5 ? 'caution' : 'danger';
  return metric({ acuteEWMA: 100 * ratio, chronicEWMA: 100, ratio, zone });
}

/** What computeACWR ACTUALLY returns with under 14 days of load. */
function insufficientAcwr(): MetricResult<ACWRResult> {
  return metric(
    { acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' },
    'insufficient',
    6,
  );
}

function monotony(mean: number, sd: number): MetricResult<MonotonyResult> {
  const m = sd === 0 ? 100 : mean / sd;
  return metric({
    monotony: m,
    strain: mean * 7 * m,
    mean,
    sd,
    band: m > 2 ? 'high' : m > 1 ? 'moderate' : 'low',
  });
}

/** What getMonotony() returns on a week with no Whoop data: sufficiency 'ok',
 *  mean 0, sd 0 — and therefore band 'high' at the cap. */
function emptyWeekMonotony(): MetricResult<MonotonyResult> {
  return metric({ monotony: 100, strain: 0, mean: 0, sd: 0, band: 'high' }, 'ok', 7);
}

function polarised(midPct: number): MetricResult<PolarisedResult> {
  const rest = 100 - midPct;
  return metric({
    easyPct: rest * 0.8,
    midPct,
    hardPct: rest * 0.2,
    verdict: midPct > 50 ? 'junk-middle' : 'pyramid',
    totalMinutes: 320,
  });
}

function insufficientPolarised(): MetricResult<PolarisedResult> {
  return metric(
    { easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume', totalMinutes: 0 },
    'insufficient',
    0,
  );
}

const BASE: BaseProposal = { sport: 'run', targetDistanceM: 10_000 };

function state(over: Partial<TrainingState> = {}): TrainingState {
  return {
    acwr: null,
    monotony: null,
    polarised: null,
    yesterdayIntensity: null,
    last8Weeks: { run: 20 },
    last2Weeks: { run: 5 },
    readiness: null,
    ...over,
  };
}

// ——— The zero-struct guards ————————————————————————————————————————

describe('the insufficient-MetricResult trap', () => {
  it('reads an insufficient ACWR as no signal, not as detraining', () => {
    // The struct says zone 'detraining' and ratio 0. Both are lies from a
    // metric that had six days of data.
    const m = insufficientAcwr();
    expect(m.value.zone).toBe('detraining');
    expect(m.value.ratio).toBe(0);
    expect(usableAcwr(m)).toBeNull();
  });

  it('does NOT force recovery off a zero-filled insufficient ACWR', () => {
    const p = applyProgression(BASE, state({ acwr: insufficientAcwr() }));
    expect(p.intensity).not.toBe('recovery');
    expect(p.targetDistanceM).toBe(10_000);
    expect(p.why.join(' ')).not.toMatch(/recovery/i);
  });

  it('does NOT invite a build off a zero-filled insufficient ACWR', () => {
    // ratio 0 is < 0.8. Without the sufficiency guard this is a build week.
    const p = applyProgression(BASE, state({ acwr: insufficientAcwr() }));
    expect(p.targetDistanceM).toBe(10_000);
    expect(p.why.join(' ')).not.toMatch(/room to build/i);
    expect(p.why.join(' ')).toMatch(/not enough load history/i);
  });

  it('refuses a ratio of exactly zero even when the result claims sufficiency', () => {
    // A real chronic load of 0 divides to 0 and is not a training signal.
    expect(usableAcwr(acwr(0))).toBeNull();
  });

  it('ignores the monotony a zero-filled week reports, though it is never insufficient', () => {
    const m = emptyWeekMonotony();
    expect(m.sufficiency).toBe('ok'); // the service zero-fills, so it always is
    expect(m.value.band).toBe('high'); // maximum sameness, off no data at all
    expect(usableMonotony(m)).toBeNull();

    const p = applyProgression(BASE, state({ monotony: m, yesterdayIntensity: 'steady' }));
    expect(p.intensity).toBe('steady');
    expect(p.why.join(' ')).not.toMatch(/samey/i);
  });

  it('ignores an insufficient polarised result', () => {
    const p = applyProgression(BASE, state({ polarised: insufficientPolarised() }));
    expect(p.intensity).toBe('steady');
    expect(p.why.join(' ')).not.toMatch(/middle zone/i);
  });
});

// ——— The rules, one at a time ————————————————————————————————————

describe('applyProgression — one rule at a time', () => {
  it('1. an ACWR over 1.4 forces recovery and caps the distance', () => {
    const p = applyProgression(BASE, state({ acwr: acwr(1.62) }));
    expect(p.intensity).toBe('recovery');
    expect(p.targetDistanceM).toBeLessThan(10_000);
    expect(p.targetDistanceM).toBeLessThanOrEqual(6000);
    expect(p.why[0]).toMatch(/1\.62/);
  });

  it('1. an ACWR of exactly 1.4 does not trip it', () => {
    const p = applyProgression(BASE, state({ acwr: acwr(1.4) }));
    expect(p.intensity).not.toBe('recovery');
  });

  it('2. an ACWR under 0.8 invites a build', () => {
    const p = applyProgression(BASE, state({ acwr: acwr(0.65) }));
    expect(p.targetDistanceM).toBe(11_000);
    expect(p.why.join(' ')).toMatch(/room to build/i);
  });

  it('3. a high monotony band forces an intensity different from yesterday', () => {
    const p = applyProgression(
      BASE,
      state({ monotony: monotony(12, 3), yesterdayIntensity: 'steady' }),
    );
    expect(p.intensity).not.toBe('steady');
    expect(p.why.join(' ')).toMatch(/samey/i);
  });

  it('3. and leaves it alone when it already differs from yesterday', () => {
    const p = applyProgression(
      { ...BASE },
      state({
        acwr: acwr(0.7), // steady + build
        monotony: monotony(12, 3),
        yesterdayIntensity: 'intervals',
      }),
    );
    expect(p.intensity).toBe('steady');
    expect(p.why.join(' ')).toMatch(/samey/i);
  });

  it('4. a middle-heavy week with load to spare pushes to intervals', () => {
    const p = applyProgression(BASE, state({ acwr: acwr(1.0), polarised: polarised(62) }));
    expect(p.intensity).toBe('intervals');
    expect(p.why.join(' ')).toMatch(/middle zone/i);
  });

  it('4. a middle-heavy week with the load already high pushes to easy-long instead', () => {
    const p = applyProgression(BASE, state({ acwr: acwr(1.25), polarised: polarised(62) }));
    expect(p.intensity).toBe('easy');
    expect(p.targetDistanceM).toBeGreaterThan(10_000);
  });

  it('4. a well-polarised week changes nothing', () => {
    const p = applyProgression(BASE, state({ polarised: polarised(12) }));
    expect(p.intensity).toBe('steady');
    expect(p.why.join(' ')).not.toMatch(/middle zone/i);
  });

  it('5. nudges toward a sport with real history that has gone missing', () => {
    const p = applyProgression(
      BASE,
      state({ last8Weeks: { run: 20, ride: 6 }, last2Weeks: { run: 6 } }),
    );
    expect(p.sport).toBe('ride');
    expect(p.why.join(' ')).toMatch(/has not happened in the last fortnight/i);
    // The distance is transferred into the new sport's own scale, not carried
    // across — 10 km of running is not 10 km of riding.
    expect(p.targetDistanceM).toBeGreaterThan(10_000);
  });

  it('5. one outing eight weeks ago is not a lapsed habit', () => {
    expect(
      neglectedSport({ last8Weeks: { run: 20, mtb: 1 }, last2Weeks: { run: 6 } }, 'run'),
    ).toBeNull();
  });

  it('5. a sport still being done in the last fortnight is not neglected', () => {
    expect(
      neglectedSport({ last8Weeks: { run: 20, ride: 6 }, last2Weeks: { run: 6, ride: 1 } }, 'run'),
    ).toBeNull();
  });

  it('reports which of the four ACWRs it read', () => {
    const p = applyProgression(BASE, state({ acwr: acwr(1.0) }));
    expect(p.acwrSource).toMatch(/EWMA/);
    expect(p.acwrSource).toMatch(/TRIMP/);
  });

  it('estimates a time that follows the sport, not the walking fallback', () => {
    const swim = applyProgression({ sport: 'swim', targetDistanceM: 1500 }, state({ last8Weeks: {}, last2Weeks: {} }));
    expect(swim.sport).toBe('swim');
    // 1.5 km at ~3 km/h is half an hour, not the eighteen minutes a walking
    // fallback speed would price it at.
    expect(swim.targetMinutes).toBeGreaterThan(25);
  });
});

// ——— Precedence ————————————————————————————————————————————————————

describe('applyProgression — precedence', () => {
  it('the load ratio outranks every rule under it', () => {
    const p = applyProgression(
      BASE,
      state({
        acwr: acwr(1.8),
        monotony: monotony(12, 3),
        polarised: polarised(70),
        yesterdayIntensity: 'recovery',
        last8Weeks: { run: 20, ride: 6 },
        last2Weeks: { run: 6 },
      }),
    );
    expect(p.intensity).toBe('recovery'); // not 'easy' from monotony, not 'intervals'
    expect(p.sport).toBe('run'); // the neglected-ride nudge waits for a day with room
    expect(p.targetDistanceM).toBeLessThanOrEqual(6000);
    // Every rule still speaks; none of them overrules.
    expect(p.why.length).toBeGreaterThanOrEqual(4);
    expect(p.why.join(' ')).toMatch(/recovery stands/i);
    expect(p.why.join(' ')).toMatch(/load ratio comes first/i);
    expect(p.why.join(' ')).toMatch(/can wait for a day/i);
  });

  it('the middle-heavy push overrides the monotony change, in that order', () => {
    const p = applyProgression(
      BASE,
      state({
        acwr: acwr(1.0),
        monotony: monotony(12, 3),
        yesterdayIntensity: 'steady',
        polarised: polarised(64),
      }),
    );
    expect(p.intensity).toBe('intervals');
    const why = p.why.join(' | ');
    expect(why.indexOf('samey')).toBeLessThan(why.indexOf('middle zone'));
  });

  it('a build and a neglected sport compose', () => {
    const p = applyProgression(
      BASE,
      state({
        acwr: acwr(0.6),
        last8Weeks: { run: 20, hike: 5 },
        last2Weeks: { run: 6 },
      }),
    );
    expect(p.sport).toBe('hike');
    expect(p.why.join(' ')).toMatch(/room to build/i);
    expect(p.why.join(' ')).toMatch(/hike/i);
  });

  it('appends one line per rule that fires and none for rules that do not', () => {
    const quiet = applyProgression(BASE, state({ acwr: acwr(1.0) }));
    expect(quiet.why).toEqual([]);
  });
});

// ——— The gettable scorer ——————————————————————————————————————————

function candidate(over: Partial<GettableCandidate> = {}): GettableCandidate {
  return {
    id: 1,
    name: 'Mill Lane climb',
    activityType: 'run',
    distanceM: 1200,
    pbDurationS: 300,
    recentBestS: 309, // 3% off
    effortCount: 12,
    daysSincePb: 400,
    ...over,
  };
}

describe('rankGettableSegments', () => {
  it('scores a small non-zero gap above a huge one', () => {
    expect(gapScore(0.03)).toBeGreaterThan(gapScore(0.35));
    expect(gapScore(0.03)).toBeGreaterThan(gapScore(0));
    expect(gapScore(0.9)).toBe(0);
  });

  it('a segment with two efforts must not outrank one with ten', () => {
    const thin = candidate({ id: 1, name: 'Two goes', effortCount: 2 });
    const thick = candidate({ id: 2, name: 'Ten goes', effortCount: 10 });
    const [first, second] = rankGettableSegments([thin, thick], {
      targetDistanceM: 10_000,
      limit: 2,
      minScore: 0,
    });
    expect(first.name).toBe('Ten goes');
    expect(second.name).toBe('Two goes');
    expect(first.score).toBeGreaterThan(second.score);
    expect(trustScore(2)).toBeLessThan(trustScore(10));
  });

  it('says so in the reason when the PB is off too few efforts', () => {
    const [only] = rankGettableSegments([candidate({ effortCount: 3 })], {
      targetDistanceM: 10_000,
      minScore: 0,
    });
    expect(only.reason).toMatch(/only 3 efforts/i);
  });

  it('a PB set yesterday must not outrank a two-year-old one at the same gap', () => {
    const fresh = candidate({ id: 1, name: 'Set yesterday', daysSincePb: 1 });
    const ancient = candidate({ id: 2, name: 'Set two years ago', daysSincePb: 730 });
    const ranked = rankGettableSegments([fresh, ancient], {
      targetDistanceM: 10_000,
      limit: 2,
      minScore: 0,
    });
    expect(ranked[0].name).toBe('Set two years ago');
    expect(stalenessScore(1)).toBe(0);
    expect(stalenessScore(730)).toBe(1);
  });

  it('a ride never wins a pace-sport EF comparison', () => {
    // A ride's EF runs about four times a run's, so its "trend" is not
    // comparable. It is not computed at all — null, and the form term sits
    // neutral rather than being handed a number from a different scale.
    expect(efTrendPct('ride', [4.1, 4.4, 4.8, 5.2, 5.9])).toBeNull();
    expect(efTrendPct('mtb', [4.1, 4.4, 4.8, 5.2, 5.9])).toBeNull();
    expect(efTrendPct('run', [1.0, 1.02, 1.04, 1.06, 1.08])).toBeGreaterThan(0);

    const ride = candidate({
      id: 1,
      name: 'Ashopton drag',
      activityType: 'ride',
      recentEf: [4.1, 4.4, 4.8, 5.2, 5.9],
    });
    const run = candidate({
      id: 2,
      name: 'Mill Lane climb',
      activityType: 'run',
      recentEf: [1.0, 1.02, 1.04, 1.06, 1.08],
    });
    const ranked = rankGettableSegments([ride, run], {
      targetDistanceM: 10_000,
      limit: 2,
      minScore: 0,
    });
    expect(ranked[0].name).toBe('Mill Lane climb');
    expect(ranked.find((r) => r.activityType === 'ride')?.efTrendPct).toBeNull();
  });

  it('a falling EF trend costs a pace segment its place', () => {
    const rising = candidate({ id: 1, name: 'Rising', recentEf: [1.0, 1.03, 1.06, 1.09, 1.12] });
    const falling = candidate({ id: 2, name: 'Falling', recentEf: [1.12, 1.09, 1.06, 1.03, 1.0] });
    const ranked = rankGettableSegments([falling, rising], {
      targetDistanceM: 10_000,
      limit: 2,
      minScore: 0,
    });
    expect(ranked[0].name).toBe('Rising');
  });

  it('fits the segment to the session rather than to itself', () => {
    expect(fitScore(1200, 10_000)).toBe(1);
    expect(fitScore(9000, 10_000)).toBeLessThan(0.2);
    expect(fitScore(60, 10_000)).toBeLessThan(0.5);
  });

  it('never merges a climb with its descent', () => {
    // Two rows, same ground, opposite directions, separate leaderboards. They
    // are two targets and stay two targets.
    const up = candidate({ id: 10, name: 'Stanage Causeway up', pbDurationS: 480, recentBestS: 494 });
    const down = candidate({ id: 11, name: 'Stanage Causeway down', pbDurationS: 300, recentBestS: 309 });
    const ranked = rankGettableSegments([up, down], {
      targetDistanceM: 10_000,
      limit: 5,
      minScore: 0,
    });
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.id).sort()).toEqual([10, 11]);
    expect(new Set(ranked.map((r) => r.pbDurationS)).size).toBe(2);
  });

  it('drops a segment with no PB or a single effort', () => {
    const ranked = rankGettableSegments(
      [
        candidate({ id: 1, pbDurationS: null }),
        candidate({ id: 2, effortCount: 1 }),
        candidate({ id: 3 }),
      ],
      { targetDistanceM: 10_000, limit: 5, minScore: 0 },
    );
    expect(ranked.map((r) => r.id)).toEqual([3]);
  });

  it('aims at the record, and just under it when the record is already matched', () => {
    const [behind] = rankGettableSegments([candidate({ pbDurationS: 300, recentBestS: 315 })], {
      targetDistanceM: 10_000,
      minScore: 0,
    });
    expect(behind.targetDurationS).toBe(300);
    expect(behind.gapS).toBe(15);

    const [level] = rankGettableSegments([candidate({ pbDurationS: 300, recentBestS: 300 })], {
      targetDistanceM: 10_000,
      minScore: 0,
    });
    expect(level.targetDurationS).toBe(297);
    expect(level.gapPct).toBe(0);
  });

  it('honours the limit and the floor', () => {
    const many = Array.from({ length: 9 }, (_, i) => candidate({ id: i + 1, name: `S${i + 1}` }));
    expect(rankGettableSegments(many, { targetDistanceM: 10_000, limit: 3 })).toHaveLength(3);
    expect(
      rankGettableSegments(many, { targetDistanceM: 10_000, minScore: 0.99 }),
    ).toHaveLength(0);
  });

  it('survives an empty list', () => {
    expect(rankGettableSegments([], { targetDistanceM: 10_000 })).toEqual([]);
  });
});


describe('applyProgression — readiness', () => {
  it('spends a peak day instead of proposing the usual walk', () => {
    // The failure this exists for: 94% recovery, HRV up, slept well — and the
    // proposal was a 2 km walk, because nothing read readiness upward.
    const p = applyProgression(
      { sport: 'walk', targetDistanceM: 1800 },
      state({ readiness: 92, last8Weeks: { walk: 30, run: 8 }, last2Weeks: { walk: 6 } }),
    );
    expect(p.sport).toBe('run');
    expect(p.targetDistanceM).toBeGreaterThan(1800);
    expect(p.intensity).toBe('threshold');
    expect(p.why.join(' ')).toMatch(/Readiness is 92/);
  });

  it('will not upgrade to a sport with no real history', () => {
    const p = applyProgression(
      { sport: 'walk', targetDistanceM: 1800 },
      state({ readiness: 92, last8Weeks: { walk: 30 }, last2Weeks: { walk: 6 } }),
    );
    expect(p.sport).toBe('walk');
    // Still a bigger day, just the same kind of day.
    expect(p.targetDistanceM).toBeGreaterThan(1800);
  });

  it('lengthens a strong day without making it hard', () => {
    const p = applyProgression(
      { sport: 'run', targetDistanceM: 8000 },
      state({ readiness: 74 }),
    );
    expect(p.intensity).toBe('steady');
    expect(p.targetDistanceM).toBeGreaterThan(8000);
  });

  it('leaves an ordinary day alone', () => {
    const p = applyProgression({ sport: 'run', targetDistanceM: 8000 }, state({ readiness: 55 }));
    expect(p.targetDistanceM).toBe(8000);
    expect(p.why.join(' ')).toMatch(/working day rather than a big one/);
  });

  it('NEVER overrides the overreached lock, however good the body feels', () => {
    // Feeling fine on top of a 1.6 ratio is how people get hurt.
    const p = applyProgression(
      { sport: 'run', targetDistanceM: 8000 },
      state({ readiness: 95, acwr: acwr(1.6) }),
    );
    expect(p.intensity).toBe('recovery');
    expect(p.targetDistanceM).toBeLessThan(8000);
    expect(p.why.join(' ')).not.toMatch(/day to spend/);
  });

  it('does nothing at all when readiness could not be read', () => {
    const withNull = applyProgression({ sport: 'run', targetDistanceM: 8000 }, state({ readiness: null }));
    expect(withNull.targetDistanceM).toBe(8000);
    expect(withNull.why.join(' ')).not.toMatch(/Readiness/);
  });
});

describe('strongerSport', () => {
  it('picks the most demanding sport with real history', () => {
    expect(strongerSport(state({ last8Weeks: { walk: 30, run: 8, ride: 4 } }), 'walk')).toBe('run');
    expect(strongerSport(state({ last8Weeks: { walk: 30, ride: 4 } }), 'walk')).toBe('ride');
  });

  it('refuses a sport you have barely done', () => {
    expect(strongerSport(state({ last8Weeks: { walk: 30, run: 1 } }), 'walk')).toBeNull();
  });

  it('has nothing to offer the most demanding sport already', () => {
    expect(strongerSport(state({ last8Weeks: { trail_run: 20 } }), 'trail_run')).toBeNull();
  });
});
