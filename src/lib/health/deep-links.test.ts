// The point of every test below is the ROUND TRIP.
//
// A deep link is only worth having if the page at the other end reads it the
// way the page that emitted it meant it. Asserting the query string looks right
// proves nothing — `?form=Improving` looks right too, and lands the explorer
// unfiltered without an error anywhere. So each test hands what `deep-links`
// emits to the parser the destination page actually runs, and asserts on the
// FILTER STATE that comes back.
import { describe, it, expect } from 'vitest';
import {
  activitiesHref,
  gettableHref,
  parsePlannerSeed,
  plannerHref,
  seedIsEmpty,
  segmentHref,
  segmentsHref,
  taxonomyHref,
  PLANNER_SPORTS,
  PLAN_PATH,
  SEGMENTS_PATH,
} from './deep-links';
import { parseFilters, parseSort, FORM_STATES } from './segment-list';
import {
  parseFilters as parseActivityFilters,
  parseSort as parseActivitySort,
} from './activity-list';
import { GETTABLE_GAP_PCT, MIN_EFFORTS_FOR_FORM } from '$lib/trails/segments/form';

/** The explorer's own seeding step: everything after the `?`, parsed. */
function seedExplorer(href: string, knownTypes: string[] = []) {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  return { path, filters: parseFilters(params, knownTypes), sort: parseSort(params) };
}

function seedLedger(href: string, knownTypes: string[] = []) {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  return { path, filters: parseActivityFilters(params, knownTypes), sort: parseActivitySort(params) };
}

describe('segmentsHref', () => {
  it('with no options is the bare explorer, with no dangling question mark', () => {
    expect(segmentsHref()).toBe(SEGMENTS_PATH);
  });

  it('round-trips a form filter through the explorer’s own parser', () => {
    const { path, filters } = seedExplorer(segmentsHref({ forms: ['improving'] }));
    expect(path).toBe(SEGMENTS_PATH);
    expect(filters.forms).toEqual(['improving']);
    expect(filters.types).toEqual([]);
  });

  it('round-trips a type filter only when the destination knows that type', () => {
    const href = segmentsHref({ types: ['Run'] });
    // The explorer validates types against the corpus it loaded, so an unknown
    // type is dropped there rather than producing an inexplicably empty table.
    expect(seedExplorer(href, ['Run']).filters.types).toEqual(['Run']);
    expect(seedExplorer(href, ['Ride']).filters.types).toEqual([]);
  });

  it('round-trips a sort', () => {
    const { sort } = seedExplorer(segmentsHref({ sort: { key: 'gap', dir: 'asc' } }));
    expect(sort).toEqual({ key: 'gap', dir: 'asc' });
  });

  it('encodes a gap ceiling as a PERCENTAGE range, not a fraction', () => {
    const { filters } = seedExplorer(segmentsHref({ maxGapPct: 3 }));
    expect(filters.ranges.gap).toEqual({ min: null, max: 3 });
  });

  it('encodes an efforts floor as an open-ended range', () => {
    const { filters } = seedExplorer(segmentsHref({ minEfforts: 6 }));
    expect(filters.ranges.efforts).toEqual({ min: 6, max: null });
  });

  it('drops a blank name rather than emitting an empty q', () => {
    expect(segmentsHref({ name: '   ' })).toBe(SEGMENTS_PATH);
  });
});

describe('taxonomyHref', () => {
  // Section F prints four counts. Every one of them must have a link that
  // filters to exactly that state — including `unknown`, which is the largest
  // tile and the one most likely to be forgotten because it reads as "no data".
  it.each(FORM_STATES)('round-trips the %s tile', (direction) => {
    const { filters } = seedExplorer(taxonomyHref(direction));
    expect(filters.forms).toEqual([direction]);
  });

  it('sorts slipping the other way, so the worst row is first', () => {
    expect(seedExplorer(taxonomyHref('slipping')).sort).toEqual({ key: 'form', dir: 'desc' });
    expect(seedExplorer(taxonomyHref('improving')).sort).toEqual({ key: 'form', dir: 'asc' });
  });
});

describe('gettableHref', () => {
  it('applies the board’s own three gates, read off the shared constants', () => {
    const { filters, sort } = seedExplorer(gettableHref());
    expect(filters.forms).toEqual(['improving']);
    // If GETTABLE_GAP_PCT or MIN_EFFORTS_FOR_FORM move, the link moves with
    // them — the dashboard count and the linked list must never disagree.
    expect(filters.ranges.gap).toEqual({ min: null, max: GETTABLE_GAP_PCT * 100 });
    expect(filters.ranges.efforts).toEqual({ min: MIN_EFFORTS_FOR_FORM, max: null });
    expect(sort).toEqual({ key: 'gap', dir: 'asc' });
  });

  it('does not filter on staleness, which the board shows but does not gate on', () => {
    const { filters } = seedExplorer(gettableHref());
    expect(filters.ranges.staleness).toEqual({ min: null, max: null });
  });
});

describe('segmentHref', () => {
  it('addresses one segment', () => {
    expect(segmentHref(412)).toBe('/health/segments/412');
  });
});

describe('plannerHref / parsePlannerSeed', () => {
  it('with no seed is the bare planner', () => {
    expect(plannerHref()).toBe(PLAN_PATH);
    expect(seedIsEmpty(parsePlannerSeed(new URLSearchParams()))).toBe(true);
  });

  it('round-trips every field', () => {
    const seed = {
      sport: 'trail_run' as const,
      km: 12.5,
      prefer: 'steady' as const,
      climbPerKm: 40,
      mode: 'loop' as const,
      from: 'move:long-easy-day',
      why: 'Pulls ACWR back off the detraining edge.',
    };
    const href = plannerHref(seed);
    expect(href.startsWith(`${PLAN_PATH}?`)).toBe(true);
    const back = parsePlannerSeed(new URLSearchParams(href.split('?')[1]));
    expect(back).toEqual(seed);
    expect(seedIsEmpty(back)).toBe(false);
  });

  it.each(PLANNER_SPORTS)('round-trips the %s sport', (sport) => {
    const back = parsePlannerSeed(new URLSearchParams(plannerHref({ sport }).split('?')[1]));
    expect(back.sport).toBe(sport);
  });

  it('omits prefer=any, which is the planner’s own default', () => {
    expect(plannerHref({ prefer: 'any' })).toBe(PLAN_PATH);
  });

  it('rounds the distance to one decimal, the precision the field shows', () => {
    expect(plannerHref({ km: 12.3456 })).toBe(`${PLAN_PATH}?km=12.3`);
  });

  // The whole reason parse validates: a hand-edited or stale link must land on
  // the planner's OWN proposal, which is computed from live readiness. Clamping
  // `km=9999` to 100 would open a plan nobody asked for; dropping it lets the
  // live proposal stand.
  it('drops an unknown sport rather than seeding one', () => {
    expect(parsePlannerSeed(new URLSearchParams('sport=swim')).sport).toBeUndefined();
  });

  it('drops an out-of-range distance rather than clamping it', () => {
    expect(parsePlannerSeed(new URLSearchParams('km=9999')).km).toBeUndefined();
    expect(parsePlannerSeed(new URLSearchParams('km=0')).km).toBeUndefined();
    expect(parsePlannerSeed(new URLSearchParams('km=nonsense')).km).toBeUndefined();
  });

  it('drops an implausible climb rather than clamping it', () => {
    expect(parsePlannerSeed(new URLSearchParams('climb=500')).climbPerKm).toBeUndefined();
    expect(parsePlannerSeed(new URLSearchParams('climb=40')).climbPerKm).toBe(40);
  });

  it('drops a junk preference and a junk mode', () => {
    expect(parsePlannerSeed(new URLSearchParams('prefer=fast')).prefer).toBeUndefined();
    expect(parsePlannerSeed(new URLSearchParams('mode=zigzag')).mode).toBeUndefined();
  });

  it('bounds the provenance strings, which are rendered', () => {
    const long = 'x'.repeat(400);
    const back = parsePlannerSeed(new URLSearchParams(`from=${long}&why=${long}`));
    expect(back.from).toHaveLength(80);
    expect(back.why).toHaveLength(200);
  });

  it('treats provenance alone as an empty seed — it changes nothing on the form', () => {
    expect(seedIsEmpty(parsePlannerSeed(new URLSearchParams('from=move:hold-and-watch')))).toBe(true);
  });
});

describe('activitiesHref', () => {
  it('with no options is the bare ledger', () => {
    expect(activitiesHref()).toBe('/health/activities');
  });

  it('round-trips day bounds as the ledger’s own two params', () => {
    const { filters } = seedLedger(activitiesHref({ from: '2026-08-01', to: '2026-08-31' }));
    expect(filters.from).toBe('2026-08-01');
    expect(filters.to).toBe('2026-08-31');
  });

  it('drops a day bound that is not a day', () => {
    expect(activitiesHref({ from: 'last tuesday' })).toBe('/health/activities');
  });

  it('round-trips a type filter and a sort', () => {
    const href = activitiesHref({ types: ['Run'], sort: { key: 'distance', dir: 'desc' } });
    const { filters, sort } = seedLedger(href, ['Run']);
    expect(filters.types).toEqual(['Run']);
    expect(sort).toEqual({ key: 'distance', dir: 'desc' });
  });
});
