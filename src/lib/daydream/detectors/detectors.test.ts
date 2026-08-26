import { describe, it, expect } from 'vitest';
import { DETECTORS, getDetector } from './index';
import { unknownPlace } from './unknown-place';
import { nearOffer } from './near-offer';
import { nearOpenThread } from './near-open-thread';
import { interestMeetsPlace, recurringInterests } from './interest-meets-place';
import { contextMeetsHealth } from './context-meets-health';
import { freeWindow, learnedBusyHour, localDay, localHour } from './free-window';
import { patternBreak, findRoutines } from './pattern-break';
import { correlationProbe, findRepeatedPasses, isoWeek, MIN_SUPPORT } from './correlation-probe';
import { looseMatch, positionIsUsable } from './shared';
import { ruleDriven, setActiveRules, dedupeKeyFor } from './rule-driven';
import type { RuleSpec } from '../rules/spec';
import type { DaydreamSnapshot, PlaceSummary, TrailPoint } from '../snapshot-types';

// A Wednesday afternoon in August.
const NOW = new Date('2026-08-26T13:00:00Z');
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function place(over: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    id: 'p1',
    lat: 51.5,
    lon: -0.12,
    radiusM: 200,
    label: null,
    kind: 'unknown',
    source: 'inferred',
    visitCount: 4,
    medianDwellMins: 25,
    dayHistogram: [0, 0, 0, 0, 0, 0, 0],
    hourHistogram: new Array(24).fill(0),
    firstSeenAt: daysAgo(20),
    lastSeenAt: daysAgo(1),
    status: 'active',
    ...over,
  };
}

/**
 * A well-observed trail: one point every `stepMins` for `hours`.
 *
 * The step defaults to the REAL poll cadence (2 minutes), not a round number.
 * It used to be 10, and every coverage-gated test passed regardless — because
 * the coverage divisor said 10 minutes while the activity ran every 2, so a
 * tenth of the expected density still computed as fully covered. A fixture that
 * only looks well-observed against a broken divisor is a fixture that tests
 * nothing.
 */
function trailOf(hours: number, over: Partial<TrailPoint> = {}, stepMins = 2): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (let m = hours * 60; m >= 0; m -= stepMins) {
    out.push({
      id: m,
      ts: ago(m),
      source: 'poll',
      lat: 51.5,
      lon: -0.12,
      mode: 'still',
      isHome: true,
      placeId: null,
      accuracyM: 10,
      ...over,
    });
  }
  return out;
}

function snap(over: Partial<DaydreamSnapshot> = {}): DaydreamSnapshot {
  const trail = over.trail ?? trailOf(24 * 8);
  return {
    now: NOW,
    localDate: '2026-08-26',
    localDay: 2, // Wednesday
    localHour: 14, // BST
    isWeekday: true,
    current: {
      ts: ago(2),
      lat: 51.5,
      lon: -0.12,
      mode: 'still',
      isHome: true,
      placeId: null,
      accuracyM: 10,
      ageMins: 2,
    },
    trail,
    trailDays: 30,
    trailSpanDays: 60,
    places: [],
    coverage: { last24h: 1, last7d: 1 },
    health: {
      lastNightSleep: null,
      sleepBaseline: null,
      readiness: null,
      daysSinceWorkout: null,
      trainingLoad: null,
    },
    calendar: { events: [], partial: false, available: true },
    interests: [],
    offers: { available: false, items: [] },
    memories: [],
    sources: [],
    ...over,
  };
}

describe('the registry', () => {
  it('exposes the eight hand-written detectors plus the rule runner, all unique', () => {
    expect(DETECTORS).toHaveLength(9);
    expect(new Set(DETECTORS.map((d) => d.kind)).size).toBe(9);
    expect(DETECTORS.map((d) => d.kind)).toContain('rule_driven');
  });

  it('resolves a detector by kind', () => {
    expect(getDetector('free_window')?.kind).toBe('free_window');
    expect(getDetector('nope')).toBeNull();
  });

  it('gives every detector a readiness verdict on an empty snapshot without throwing', () => {
    const empty = snap({ trailSpanDays: 0, trail: [], coverage: { last24h: 0, last7d: 0 } });
    for (const d of DETECTORS) {
      const r = d.readiness(empty);
      expect(r.ready).toBe(false);
      expect(r.reason).toBeTruthy();
      // Nothing may speak on an empty snapshot.
      expect(d.detect(empty)).toEqual([]);
    }
  });
});

describe('looseMatch', () => {
  it('matches whole words, not fragments', () => {
    expect(looseMatch('Sports Direct', 'sports direct')).toBe(true);
    // The bug this guards: substring matching makes "art" match "Dartford".
    expect(looseMatch('art', 'Dartford')).toBe(false);
    expect(looseMatch('Dartford Station', 'dartford')).toBe(true);
  });

  it('refuses very short terms, which match everything', () => {
    expect(looseMatch('co', 'coffee shop')).toBe(false);
  });
});

describe('positionIsUsable', () => {
  it('rejects a stale fix', () => {
    expect(positionIsUsable(snap({ current: { ...snap().current!, ageMins: 90 } }))).toBe(false);
  });

  it('rejects a vague fix', () => {
    expect(positionIsUsable(snap({ current: { ...snap().current!, accuracyM: 800 } }))).toBe(false);
  });

  it('rejects no fix at all', () => {
    expect(positionIsUsable(snap({ current: null }))).toBe(false);
  });

  it('accepts a fresh, tight fix', () => {
    expect(positionIsUsable(snap())).toBe(true);
  });
});

describe('unknown_place', () => {
  it('does NOT ask about somewhere visited once or twice', () => {
    // Creating a place and asking about one are different questions with
    // different costs: a place can match an offer for free, a question costs a
    // notification. One or two stops is usually a car park on the way
    // somewhere, and the place still exists to be matched against.
    for (const visitCount of [1, 2]) {
      const s = snap({ places: [place({ visitCount, medianDwellMins: 40 })] });
      expect(unknownPlace.readiness(s).ready).toBe(false);
      expect(unknownPlace.detect(s)).toEqual([]);
    }
  });

  it('asks once it has been somewhere three times', () => {
    const s = snap({ places: [place({ visitCount: 3, medianDwellMins: 25 })] });
    expect(unknownPlace.readiness(s).ready).toBe(true);
    expect(unknownPlace.detect(s)).toHaveLength(1);
  });

  it('asks about an unnamed place with enough visits', () => {
    const s = snap({ places: [place({ visitCount: 4 })] });
    expect(unknownPlace.readiness(s).ready).toBe(true);
    const [c] = unknownPlace.detect(s);
    expect(c.kind).toBe('unknown_place');
    expect(c.explanation).toContain('4 visits');
    expect(c.proposedActions.map((a) => a.kind)).toContain('name_place');
    expect(c.dedupeKey).toBe('unknown_place:p1');
  });

  it('says nothing about a place that already has a name', () => {
    const s = snap({ places: [place({ label: 'The Gym' })] });
    expect(unknownPlace.readiness(s).ready).toBe(false);
    expect(unknownPlace.detect(s)).toEqual([]);
  });

  it('says nothing about a place the owner muted', () => {
    const s = snap({ places: [place({ status: 'ignored' })] });
    expect(unknownPlace.detect(s)).toEqual([]);
  });

  it('keys on the place alone, so a dismissal holds as the geometry moves', () => {
    const a = unknownPlace.detect(snap({ places: [place({ visitCount: 4 })] }))[0];
    const b = unknownPlace.detect(snap({ places: [place({ visitCount: 9 })] }))[0];
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});

describe('near_offer', () => {
  const shop = place({ id: 'shop', label: 'Sports Direct', kind: 'shop', source: 'confirmed' });

  it('reports itself unready while the offer index does not exist', () => {
    const r = nearOffer.readiness(snap({ places: [shop] }));
    expect(r.ready).toBe(false);
    // The distinction that matters: missing source, not empty result.
    expect(r.reason).toContain('not built yet');
  });

  it('fires when an unexpired offer matches a place you are beside', () => {
    const s = snap({
      places: [shop],
      offers: {
        available: true,
        items: [
          { id: 'o1', merchant: 'Sports Direct', summary: '£20 off', expiresAt: daysAgo(-5), emailId: 'e1' },
        ],
      },
    });
    expect(nearOffer.readiness(s).ready).toBe(true);
    const [c] = nearOffer.detect(s);
    expect(c.title).toContain('Sports Direct');
    expect(c.evidence.some((e) => e.kind === 'email')).toBe(true);
  });

  it('drops an expired offer rather than down-weighting it', () => {
    // An expired voucher is worse than none — it sends you in for nothing.
    const s = snap({
      places: [shop],
      offers: {
        available: true,
        items: [
          { id: 'o1', merchant: 'Sports Direct', summary: '£20 off', expiresAt: daysAgo(3), emailId: 'e1' },
        ],
      },
    });
    expect(nearOffer.detect(s)).toEqual([]);
  });

  it('will not claim proximity on a stale fix', () => {
    const s = snap({
      current: { ...snap().current!, ageMins: 120 },
      places: [shop],
      offers: {
        available: true,
        items: [{ id: 'o1', merchant: 'Sports Direct', summary: '£20 off', expiresAt: null, emailId: 'e1' }],
      },
    });
    expect(nearOffer.detect(s)).toEqual([]);
  });
});

describe('near_open_thread', () => {
  it('joins a recent research topic to the place in front of you', () => {
    const s = snap({
      places: [place({ id: 'm', label: 'Dartford Station', kind: 'other' })],
      interests: [{ term: 'Dartford Station', source: 'research', at: daysAgo(3), refId: 'r1' }],
    });
    expect(nearOpenThread.readiness(s).ready).toBe(true);
    const [c] = nearOpenThread.detect(s);
    expect(c.explanation).toContain('research');
    expect(c.evidence.some((e) => e.kind === 'research')).toBe(true);
  });

  it('ignores an interest older than the window', () => {
    const s = snap({
      places: [place({ id: 'm', label: 'Dartford Station' })],
      interests: [{ term: 'Dartford Station', source: 'research', at: daysAgo(200), refId: 'r1' }],
    });
    expect(nearOpenThread.detect(s)).toEqual([]);
  });
});

describe('interest_meets_place', () => {
  it('needs an interest to recur, not merely appear', () => {
    const once = [{ term: 'running shoes', source: 'intel', at: daysAgo(1), refId: 'n1' }];
    expect(recurringInterests(once, NOW)).toHaveLength(0);
  });

  it('groups repeated mentions and counts them', () => {
    const many = [1, 2, 3, 4].map((i) => ({
      term: 'Running Shoes',
      source: 'intel',
      at: daysAgo(i),
      refId: `n${i}`,
    }));
    const [top] = recurringInterests(many, NOW);
    expect(top.mentions).toBe(4);
    expect(top.refIds.length).toBeLessThanOrEqual(5);
  });

  it('scores below near_offer, because it is an inference', () => {
    const s = snap({
      places: [place({ id: 'sd', label: 'Running Shoes Co', kind: 'shop' })],
      interests: [1, 2, 3, 4].map((i) => ({
        term: 'Running Shoes Co',
        source: 'intel',
        at: daysAgo(i),
        refId: `n${i}`,
      })),
    });
    const [c] = interestMeetsPlace.detect(s);
    expect(c.rawScore).toBeLessThanOrEqual(0.6);
    expect(c.explanation).toContain('inference');
  });
});

describe('context_meets_health', () => {
  const cafe = place({ id: 'c', label: 'Local Coffee', kind: 'cafe' });

  it('needs the owners own baseline before it says anything', () => {
    const s = snap({
      places: [cafe],
      health: { ...snap().health, lastNightSleep: { performance: 40, durationMins: 300 } },
    });
    const r = contextMeetsHealth.readiness(s);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('baseline');
    expect(contextMeetsHealth.detect(s)).toEqual([]);
  });

  it('fires when last night was materially below that baseline', () => {
    const s = snap({
      places: [cafe],
      health: {
        ...snap().health,
        lastNightSleep: { performance: 52, durationMins: 320 },
        sleepBaseline: 80,
      },
    });
    expect(contextMeetsHealth.readiness(s).ready).toBe(true);
    const [c] = contextMeetsHealth.detect(s);
    expect(c.components.drop).toBe(28);
    // It states the reading and stops — no instruction about the coffee.
    expect(c.explanation).not.toMatch(/should|try to|avoid/i);
  });

  it('stays quiet for ordinary night-to-night variation', () => {
    const s = snap({
      places: [cafe],
      health: {
        ...snap().health,
        lastNightSleep: { performance: 75, durationMins: 400 },
        sleepBaseline: 80,
      },
    });
    expect(contextMeetsHealth.detect(s)).toEqual([]);
  });
});

describe('free_window', () => {
  /** Weekday afternoons where the owner arrives home at 15:00 local. */
  function arrivalTrail(days: number): TrailPoint[] {
    const out: TrailPoint[] = [];
    for (let d = days; d >= 1; d--) {
      const base = new Date(NOW.getTime() - d * 86_400_000);
      base.setUTCHours(12, 0, 0, 0); // 13:00 local — out
      out.push({ id: d * 10, ts: new Date(base), source: 'poll', lat: 51.6, lon: -0.2, mode: 'vehicle', isHome: false, placeId: null, accuracyM: 10 });
      const home = new Date(base.getTime() + 2 * 3_600_000); // 15:00 local — back
      out.push({ id: d * 10 + 1, ts: home, source: 'poll', lat: 51.5, lon: -0.12, mode: 'still', isHome: true, placeId: null, accuracyM: 10 });
    }
    return out.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  it('learns the hour the house fills up from the trail', () => {
    const learned = learnedBusyHour(arrivalTrail(5), localHour, localDay);
    expect(learned).not.toBeNull();
    expect(learned!.hour).toBe(15);
    expect(learned!.days).toBeGreaterThanOrEqual(3);
  });

  it('refuses to guess from too few weekdays', () => {
    expect(learnedBusyHour(arrivalTrail(1), localHour, localDay)).toBeNull();
  });

  it('does not invent an arrival across a sensor gap', () => {
    // not-home, then a gap (isHome null), then home. Treating unknown as
    // "away" would manufacture an arrival that never happened.
    const t: TrailPoint[] = [
      { id: 1, ts: ago(300), source: 'poll', lat: 51.6, lon: -0.2, mode: 'vehicle', isHome: false, placeId: null, accuracyM: 10 },
      { id: 2, ts: ago(200), source: 'gap', lat: null, lon: null, mode: 'unknown', isHome: null, placeId: null, accuracyM: null },
      { id: 3, ts: ago(100), source: 'poll', lat: 51.5, lon: -0.12, mode: 'still', isHome: true, placeId: null, accuracyM: 10 },
    ];
    expect(learnedBusyHour(t, localHour, localDay)).toBeNull();
  });

  it('suggests a window when the signals line up', () => {
    const s = snap({
      trail: arrivalTrail(6),
      health: { ...snap().health, daysSinceWorkout: 5 },
      localHour: 12,
    });
    expect(freeWindow.readiness(s).ready).toBe(true);
    const [c] = freeWindow.detect(s);
    expect(c.components.daysSinceWorkout).toBe(5);
    expect(c.components.learnedBusyHour).toBe(15);
  });

  it('will not call an afternoon free when the diary could not be fully read', () => {
    // The failure this prevents: "your afternoon is free", said over a meeting.
    const s = snap({
      trail: arrivalTrail(6),
      health: { ...snap().health, daysSinceWorkout: 5 },
      localHour: 12,
      calendar: { events: [], partial: true, available: true },
    });
    expect(freeWindow.detect(s)).toEqual([]);
  });

  it('stands down when something is already in the diary', () => {
    const s = snap({
      trail: arrivalTrail(6),
      health: { ...snap().health, daysSinceWorkout: 5 },
      localHour: 12,
      calendar: {
        events: [{ title: 'Call', start: new Date(NOW.getTime() + 30 * 60_000), end: null, location: null }],
        partial: false,
        available: true,
      },
    });
    expect(freeWindow.detect(s)).toEqual([]);
  });

  it('stays silent when the sensor mostly missed the day', () => {
    const s = snap({
      trail: arrivalTrail(6),
      health: { ...snap().health, daysSinceWorkout: 5 },
      localHour: 12,
      coverage: { last24h: 0.2, last7d: 1 },
    });
    expect(freeWindow.detect(s)).toEqual([]);
  });
});

describe('pattern_break', () => {
  const tuesdayHabit = place({
    id: 'gym',
    label: 'The Gym',
    kind: 'gym',
    visitCount: 6,
    dayHistogram: [0, 0, 5, 0, 1, 0, 0], // mostly Wednesday (index 2)
    hourHistogram: (() => {
      const h = new Array(24).fill(0);
      h[9] = 5;
      return h;
    })(),
  });

  it('needs a month of trail before claiming a routine', () => {
    const s = snap({ places: [tuesdayHabit], trailSpanDays: 10 });
    const r = patternBreak.readiness(s);
    expect(r.ready).toBe(false);
    expect(r.need).toBe(28);
    expect(patternBreak.detect(s)).toEqual([]);
  });

  it('finds a single-weekday habit', () => {
    const [routine] = findRoutines([tuesdayHabit]);
    expect(routine.day).toBe(2);
    expect(routine.visits).toBe(5);
    expect(routine.typicalHour).toBe(9);
  });

  it('ignores a place with no dominant day', () => {
    expect(findRoutines([place({ dayHistogram: [2, 2, 2, 2, 2, 0, 0], visitCount: 10 })])).toHaveLength(0);
  });

  it('fires when the routine did not happen and the day WAS observed', () => {
    const s = snap({ places: [tuesdayHabit], trail: trailOf(24) });
    const [c] = patternBreak.detect(s);
    expect(c.kind).toBe('pattern_break');
    expect(c.explanation).toContain('absence rather than a blind spot');
  });

  it('stays silent when the sensor was down — the whole point of this detector', () => {
    // A homeserv outage must not read as a change in behaviour.
    const gaps = trailOf(24).map((t) => ({ ...t, source: 'gap', lat: null, lon: null, isHome: null }));
    const s = snap({ places: [tuesdayHabit], trail: gaps, coverage: { last24h: 0, last7d: 0 } });
    expect(patternBreak.detect(s)).toEqual([]);
  });

  it('stays silent if the routine already happened today', () => {
    // trailOf is oldest-first, so the LAST entry is the recent one. Marking
    // the first would put the visit 24h ago and prove nothing.
    const visited = trailOf(24);
    visited[visited.length - 1] = { ...visited[visited.length - 1], placeId: 'gym' };
    const s = snap({ places: [tuesdayHabit], trail: visited });
    expect(patternBreak.detect(s)).toEqual([]);
  });

  it('counts a visit just after LOCAL midnight as today, not yesterday', () => {
    // Under BST local midnight is 23:00 UTC the previous day. Using UTC
    // midnight as the day boundary puts a 00:30 local stop in yesterday and
    // answers about the wrong day for eight months of the year.
    const localHalfPastMidnight = new Date('2026-08-25T23:30:00Z'); // 00:30 on the 26th, local
    const trail = [
      ...trailOf(24),
      {
        id: 9999,
        ts: localHalfPastMidnight,
        source: 'poll',
        lat: 51.5,
        lon: -0.12,
        mode: 'still' as const,
        isHome: true,
        placeId: 'gym',
        accuracyM: 10,
      },
    ].sort((a, b) => a.ts.getTime() - b.ts.getTime());

    const s = snap({ places: [tuesdayHabit], trail });
    expect(patternBreak.detect(s)).toEqual([]);
  });
});

describe('correlation_probe', () => {
  function passes(n: number): TrailPoint[] {
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      ts: daysAgo(i),
      source: 'poll',
      lat: 51.5,
      lon: -0.12,
      mode: 'walking' as const,
      isHome: false,
      placeId: 'shop',
      accuracyM: 10,
    }));
  }

  it('says nothing below its minimum support', () => {
    const s = snap({
      places: [place({ id: 'shop', label: 'The Shop' })],
      trail: passes(MIN_SUPPORT - 1),
    });
    expect(findRepeatedPasses(s)).toHaveLength(0);
    expect(correlationProbe.detect(s)).toEqual([]);
  });

  it('needs six weeks of trail regardless of how many passes it sees', () => {
    const s = snap({
      places: [place({ id: 'shop', label: 'The Shop' })],
      trail: passes(30),
      trailSpanDays: 20,
    });
    expect(correlationProbe.readiness(s).ready).toBe(false);
    expect(correlationProbe.detect(s)).toEqual([]);
  });

  it('states its n in the title and proposes nothing', () => {
    const s = snap({
      places: [place({ id: 'shop', label: 'The Shop' })],
      trail: passes(12),
    });
    const [c] = correlationProbe.detect(s);
    // A correlation without its sample size is a rumour.
    expect(c.title).toContain('12');
    expect(c.title).toMatch(/\?$/);
    expect(c.proposedActions).toEqual([]);
    expect(c.rawScore).toBeLessThanOrEqual(0.5);
  });

  it('recurs weekly rather than daily', () => {
    expect(isoWeek(new Date('2026-08-26T00:00:00Z'))).toBe(isoWeek(new Date('2026-08-28T00:00:00Z')));
    expect(isoWeek(new Date('2026-08-26T00:00:00Z'))).not.toBe(isoWeek(new Date('2026-09-05T00:00:00Z')));
  });
});


describe('rule_driven — model-authored rules behave like any other detector', () => {
  const spec: RuleSpec = {
    kind: 'test_long_stop',
    description: 'A long stop somewhere.',
    title: 'Long stop at {{place}}',
    explanation: 'You have been here {{minutesAtCurrentPlace}} minutes.',
    when: { fact: 'minutesAtCurrentPlace', op: 'gte', value: 20 },
    base: 0.5,
    terms: [],
    minTrailDays: 5,
    dedupe: 'place-day',
    rationale: 'testing',
  };

  it('says nothing when no rule has been approved', () => {
    setActiveRules([]);
    const s = snap();
    expect(ruleDriven.readiness(s).ready).toBe(false);
    expect(ruleDriven.detect(s)).toEqual([]);
  });

  it('fires under the RULE kind, not its own', () => {
    // So per-kind weights, cooldowns and "never this kind" work per rule.
    // One bad rule must not silence the whole mechanism.
    setActiveRules([spec]);
    const trail = trailOf(2, { placeId: 'p1' });
    const s = snap({
      trail,
      places: [place({ id: 'p1', label: 'The Cafe' })],
      current: { ...snap().current!, placeId: 'p1' },
    });
    const [c] = ruleDriven.detect(s);
    expect(c.kind).toBe('test_long_stop');
    expect(c.title).toBe('Long stop at The Cafe');
    setActiveRules([]);
  });

  it('honours each rule\'s own minimum support', () => {
    setActiveRules([{ ...spec, minTrailDays: 400 }]);
    const s = snap({ trailSpanDays: 30 });
    expect(ruleDriven.readiness(s).ready).toBe(false);
    expect(ruleDriven.detect(s)).toEqual([]);
    setActiveRules([]);
  });

  it('dedupes by the shape the rule asked for', () => {
    const s = snap();
    expect(dedupeKeyFor({ ...spec, dedupe: 'day' }, s, 'p1')).toBe('test_long_stop:2026-08-26');
    expect(dedupeKeyFor({ ...spec, dedupe: 'place' }, s, 'p1')).toBe('test_long_stop:p1');
    expect(dedupeKeyFor({ ...spec, dedupe: 'place-day' }, s, 'p1')).toBe('test_long_stop:p1:2026-08-26');
    expect(dedupeKeyFor({ ...spec, dedupe: 'place' }, s, null)).toBe('test_long_stop:_nowhere');
  });
});
