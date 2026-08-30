// The segments explorer's derivations, asserted where they are computed.
//
// Every case here is a rule the page would otherwise get wrong quietly. The
// gap fraction is the one PR #591 fixed on the dashboard board; the sport
// partition is the one the old explorer carried in a comment; the taxonomy is
// the one /health's section F prints beside these same numbers.
import { describe, it, expect } from 'vitest';
import {
  buildComparator,
  buildFilterPredicate,
  clearFilter,
  countForms,
  countTerrains,
  countTypes,
  describeFilters,
  emptyFilters,
  filtersToQuery,
  formTaxonomy,
  gapPercent,
  insufficientNote,
  numericValue,
  parseFilters,
  parseSort,
  toggleFacet,
  type SegmentTableRow,
} from './segment-list';
import { UNKNOWN_FORM, type SegmentForm } from '$lib/trails/segments/form';
import type { SegmentTerrain } from '$lib/trails/segments/naming';

function form(over: Partial<SegmentForm> = {}): SegmentForm {
  return { ...UNKNOWN_FORM, ...over };
}

let nextId = 1;
function row(over: Partial<SegmentTableRow> = {}): SegmentTableRow {
  const id = over.id ?? nextId++;
  return {
    id,
    name: `ground.number.${id}`,
    activityType: 'run',
    distanceM: 1840,
    elevationGainM: 106,
    elevationLossM: 12,
    effortCount: 9,
    lastEffortAt: 1_756_000_000,
    terrain: 'climb' as SegmentTerrain,
    gradientPct: 5.1,
    offroad: false,
    bests: { durationS: 540, paceSPerKm: 293, efficiencyFactor: 1.06, beatsPerKm: 145 },
    form: form({ direction: 'holding', deltaPct: 0.4, sample: 3, gapPct: 0.04, daysSincePb: 90 }),
    ...over,
  };
}

const improving = (gapPct: number | null, over: Partial<SegmentTableRow> = {}) =>
  row({ form: form({ direction: 'improving', deltaPct: -4.2, sample: 3, gapPct }), ...over });

describe('formTaxonomy — the one derivation both pages read', () => {
  it('counts the four states and makes them add up to the total', () => {
    const rows = [
      improving(0.01),
      improving(0.2),
      row({ form: form({ direction: 'holding', deltaPct: 0.5 }) }),
      row({ form: form({ direction: 'slipping', deltaPct: 6 }) }),
      row({ form: UNKNOWN_FORM, effortCount: 2 }),
      row({ form: UNKNOWN_FORM, effortCount: 3 }),
    ];
    const t = formTaxonomy(rows);
    expect(t).toMatchObject({ improving: 2, holding: 1, slipping: 1, noRead: 2, total: 6 });
    expect(t.improving + t.holding + t.slipping + t.noRead).toBe(t.total);
    expect(t.withForm).toBe(4);
  });

  it('counts gettable exactly as the dashboard does — improving AND inside 3%', () => {
    // 0.029 is in, 0.03 is not (the board's own boundary), and a slipping
    // segment sitting on its PB is not gettable however small its gap.
    const t = formTaxonomy([
      improving(0.029),
      improving(0.03),
      improving(null),
      row({ form: form({ direction: 'slipping', deltaPct: 9, gapPct: 0.001 }) }),
    ]);
    expect(t.gettable).toBe(1);
    expect(t.improving).toBe(3);
  });

  it('reads an empty corpus as all zeroes rather than throwing', () => {
    expect(formTaxonomy([])).toMatchObject({ total: 0, noRead: 0, gettable: 0 });
  });
});

describe('gapPct is a fraction', () => {
  it('renders 0.018 as 1.8 percent, not 0.0', () => {
    expect(gapPercent(form({ gapPct: 0.018 }))).toBeCloseTo(1.8);
    expect(gapPercent(form({ gapPct: null }))).toBeNull();
  });

  it('filters the gap column in percent, the unit the cell prints', () => {
    // `gap=..3` has to admit a segment 1.8% off its PB. Reading the raw
    // fraction here would compare 0.018 against 3 and match everything.
    expect(numericValue(improving(0.018), 'gap')).toBeCloseTo(1.8);
    const inside = buildFilterPredicate({
      ...emptyFilters(),
      ranges: { ...emptyFilters().ranges, gap: { min: null, max: 3 } },
    });
    expect(inside(improving(0.018))).toBe(true);
    expect(inside(improving(0.4))).toBe(false);
  });
});

describe('sorting', () => {
  it('sinks nulls to the bottom in BOTH directions', () => {
    const withGap = improving(0.01, { id: 1 });
    const noGap = row({ id: 2, form: UNKNOWN_FORM });
    const asc = [noGap, withGap].sort(buildComparator({ key: 'gap', dir: 'asc' }, false));
    const desc = [noGap, withGap].sort(buildComparator({ key: 'gap', dir: 'desc' }, false));
    expect(asc.map((r) => r.id)).toEqual([1, 2]);
    expect(desc.map((r) => r.id)).toEqual([1, 2]);
  });

  it('puts the ground you are gaining most on top when FORM sorts ascending', () => {
    // deltaPct is a change in DURATION, so the most negative is the quickest.
    const rows = [
      row({ id: 1, form: form({ direction: 'slipping', deltaPct: 5.5 }) }),
      row({ id: 2, form: form({ direction: 'improving', deltaPct: -6.1 }) }),
      row({ id: 3, form: form({ direction: 'holding', deltaPct: 0.3 }) }),
    ];
    expect(
      [...rows].sort(buildComparator({ key: 'form', dir: 'asc' }, false)).map((r) => r.id),
    ).toEqual([2, 3, 1]);
  });

  it('never lets a ride win the EF column in a mixed set', () => {
    // A bike returns more metres for the same heartbeat — measured on the
    // production corpus the rides run 1.2–2.4 against a run's 1.15 — so across
    // sports it is not a comparable number at all and it sinks. Filtered to
    // one sport the set is internally comparable and it ranks.
    const ride = row({ id: 1, activityType: 'ride', bests: { ...row().bests, efficiencyFactor: 4.1 } });
    const run = row({ id: 2, activityType: 'run', bests: { ...row().bests, efficiencyFactor: 1.06 } });
    expect(
      [ride, run].sort(buildComparator({ key: 'ef', dir: 'desc' }, false)).map((r) => r.id),
    ).toEqual([2, 1]);
    expect(
      [ride, run].sort(buildComparator({ key: 'ef', dir: 'desc' }, true)).map((r) => r.id),
    ).toEqual([1, 2]);
  });

  it('ranks gradient by steepness, so a descent is not sorted last', () => {
    const down = row({ id: 1, gradientPct: -14.2 });
    const up = row({ id: 2, gradientPct: 5.1 });
    expect(
      [up, down].sort(buildComparator({ key: 'gradient', dir: 'desc' }, false)).map((r) => r.id),
    ).toEqual([1, 2]);
  });

  it('falls back to busiest-first, stably, with no sort chosen', () => {
    const rows = [row({ id: 1, effortCount: 4 }), row({ id: 2, effortCount: 63 })];
    expect([...rows].sort(buildComparator(null, false)).map((r) => r.id)).toEqual([2, 1]);
  });
});

describe('filtering', () => {
  it('ANDs terrain, off-road, form and type', () => {
    const target = row({ id: 1, terrain: 'descent', offroad: true, activityType: 'trail_run' });
    const other = row({ id: 2, terrain: 'climb', offroad: false, activityType: 'run' });
    const predicate = buildFilterPredicate({
      ...emptyFilters(),
      terrains: ['descent'],
      offroad: true,
      types: ['trail_run'],
    });
    expect(predicate(target)).toBe(true);
    expect(predicate(other)).toBe(false);
  });

  it('treats "no form read" as a filterable state of its own', () => {
    const predicate = buildFilterPredicate({ ...emptyFilters(), forms: ['unknown'] });
    expect(predicate(row({ form: UNKNOWN_FORM }))).toBe(true);
    expect(predicate(improving(0.01))).toBe(false);
  });

  it('fails a row whose value is unknown against an ACTIVE range', () => {
    // A segment with no form read cannot be shown to be inside 3% of its PB,
    // and quietly including it would make the count above the table a lie.
    const predicate = buildFilterPredicate({
      ...emptyFilters(),
      ranges: { ...emptyFilters().ranges, gap: { min: null, max: 3 } },
    });
    expect(predicate(row({ form: UNKNOWN_FORM }))).toBe(false);
  });

  it('matches the name filter on the derived identifier', () => {
    const predicate = buildFilterPredicate({ ...emptyFilters(), name: 'HOLLOWAY' });
    expect(predicate(row({ name: 'curlew.ochre.holloway' }))).toBe(true);
    expect(predicate(row({ name: 'living.matter.ground' }))).toBe(false);
  });
});

describe('facet counts come from the loaded rows', () => {
  it('counts types, terrains and form states over what is actually here', () => {
    const rows = [
      row({ activityType: 'run', terrain: 'climb' }),
      row({ activityType: 'run', terrain: 'flat' }),
      row({ activityType: 'ride', terrain: 'flat', form: UNKNOWN_FORM }),
    ];
    expect(countTypes(rows).map((t) => [t.value, t.count])).toEqual([
      ['run', 2],
      ['ride', 1],
    ]);
    // Fixed order, up to flat — a chip row that reshuffles on every filter is
    // unusable, so this is deliberately not sorted by frequency.
    expect(countTerrains(rows).map((t) => t.value)).toEqual(['climb', 'flat']);
    const forms = Object.fromEntries(countForms(rows).map((f) => [f.value, f.count]));
    expect(forms).toMatchObject({ holding: 2, unknown: 1, improving: 0 });
  });
});

describe('the URL', () => {
  it('round-trips filters and a sort', () => {
    const filters = {
      ...emptyFilters(),
      types: ['trail_run'],
      terrains: ['descent' as SegmentTerrain],
      forms: ['improving' as const],
      offroad: true,
      name: 'holloway',
    };
    const query = filtersToQuery(filters, { key: 'gap', dir: 'asc' });
    const back = parseFilters(new URLSearchParams(query), ['trail_run', 'run']);
    expect(back).toMatchObject({
      types: ['trail_run'],
      terrains: ['descent'],
      forms: ['improving'],
      offroad: true,
      name: 'holloway',
    });
    expect(parseSort(new URLSearchParams(query))).toEqual({ key: 'gap', dir: 'asc' });
  });

  it('drops a type that is not in this corpus rather than emptying the table', () => {
    const back = parseFilters(new URLSearchParams('type=kayak'), ['run']);
    expect(back.types).toEqual([]);
  });

  it('keeps the old explorer’s links working', () => {
    // `sort=gettable` and `terrain=offroad` are in bookmarks; both used to
    // mean something this page still does.
    expect(parseSort(new URLSearchParams('sort=gettable'))).toEqual({ key: 'gap', dir: 'asc' });
    expect(parseSort(new URLSearchParams('sort=steepest'))).toEqual({
      key: 'gradient',
      dir: 'desc',
    });
    expect(parseSort(new URLSearchParams('sort=improving'))).toEqual({ key: 'form', dir: 'asc' });
    const back = parseFilters(new URLSearchParams('terrain=offroad'), ['run']);
    expect(back.offroad).toBe(true);
    expect(back.terrains).toEqual([]);
  });

  it('falls back to the column’s own first direction when none is given', () => {
    expect(parseSort(new URLSearchParams('sort=distance'))).toEqual({
      key: 'distance',
      dir: 'desc',
    });
    expect(parseSort(new URLSearchParams('sort=nonsense'))).toBeNull();
  });
});

describe('chips', () => {
  it('describes only the filters the chip rows do not draw themselves', () => {
    const filters = {
      ...emptyFilters(),
      types: ['run'],
      name: 'holloway',
      ranges: { ...emptyFilters().ranges, climb: { min: 50, max: null } },
    };
    const chips = describeFilters(filters);
    expect(chips.map((c) => c.id)).toEqual(['name', 'climb']);
    expect(chips[1].label).toBe('Climb ≥ 50 m');
  });

  it('clears one chip without touching the others', () => {
    const filters = { ...emptyFilters(), name: 'x', types: ['run'] };
    clearFilter(filters, { id: 'name', kind: 'name', label: '' });
    expect(filters.name).toBe('');
    expect(filters.types).toEqual(['run']);
  });

  it('toggles a facet value in and out, and clears on null', () => {
    expect(toggleFacet<string>([], 'climb')).toEqual(['climb']);
    expect(toggleFacet(['climb'], 'climb')).toEqual([]);
    expect(toggleFacet(['climb', 'flat'], null)).toEqual([]);
  });
});

describe('sufficiency', () => {
  it('says which side of the six-effort floor a row failed on', () => {
    expect(insufficientNote(row({ effortCount: 1 }))).toContain('1 effort —');
    expect(insufficientNote(row({ effortCount: 4 }))).toContain('under the 6');
    expect(insufficientNote(row({ effortCount: 11 }))).toContain('earlier window');
  });
});

describe('cost ranks like efficiency', () => {
  it('sinks a segment whose sport is not comparable, and ranks it when it is', () => {
    // Heartbeats per kilometre is the same partition problem as EF upside
    // down: cheap on a bike is not cheap on foot.
    const ride = row({ id: 1, activityType: 'ride', bests: { ...row().bests, beatsPerKm: 90 } });
    const run = row({ id: 2, activityType: 'run', bests: { ...row().bests, beatsPerKm: 145 } });
    expect(
      [ride, run].sort(buildComparator({ key: 'cost', dir: 'asc' }, false)).map((r) => r.id),
    ).toEqual([2, 1]);
    expect(
      [ride, run].sort(buildComparator({ key: 'cost', dir: 'asc' }, true)).map((r) => r.id),
    ).toEqual([1, 2]);
  });
});
