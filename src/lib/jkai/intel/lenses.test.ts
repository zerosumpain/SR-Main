import { describe, it, expect } from 'vitest';
import {
  activeLensFilterCount,
  buildLensFilter,
  describeLensFilters,
  entityIdsInRange,
  eventExtent,
  eventInRange,
  eventTime,
  eventsInRange,
  isEmptyLensFilters,
  isFullRange,
  lensGrowth,
  matchesLens,
  nextFreeSlug,
  normaliseLensFilters,
  normaliseRange,
  parseDateInput,
  parseRangeInputs,
  slugify,
  toDateInput,
  DAY_MS,
  EMPTY_LENS_FILTERS,
  FULL_RANGE,
  MAX_FACET_VALUES,
  MAX_QUERY_LENGTH,
  type LensCandidate,
  type LensFilters,
  type TimelinePoint,
} from './lenses';

function filters(over: Partial<LensFilters> = {}): LensFilters {
  return { ...EMPTY_LENS_FILTERS, ...over };
}

function entity(over: Partial<LensCandidate> = {}): LensCandidate {
  return {
    id: 'e1',
    name: 'IBCA',
    aliases: ['Infected Blood Compensation Authority'],
    summary: 'Arms-length body',
    typeId: 'org',
    lens: 'professional',
    confidenceScore: 0.8,
    sources: ['web'],
    community: 3,
    ...over,
  };
}

// ── normaliseLensFilters ─────────────────────────────────────────────────────

describe('normaliseLensFilters', () => {
  it('turns junk into the empty filter rather than throwing', () => {
    expect(normaliseLensFilters(null)).toEqual(EMPTY_LENS_FILTERS);
    expect(normaliseLensFilters('nonsense')).toEqual(EMPTY_LENS_FILTERS);
    expect(normaliseLensFilters(42)).toEqual(EMPTY_LENS_FILTERS);
    expect(normaliseLensFilters({ typeIds: 'org' })).toEqual(filters({ typeIds: ['org'] }));
  });

  it('accepts arrays and CSV, de-duplicating and trimming', () => {
    expect(normaliseLensFilters({ typeIds: ['a', ' b ', 'a'] }).typeIds).toEqual(['a', 'b']);
    expect(normaliseLensFilters({ sources: 'web, gmail ,web' }).sources).toEqual(['web', 'gmail']);
  });

  it('caps facet lists so a saved lens cannot build an unbounded IN-list', () => {
    const many = Array.from({ length: MAX_FACET_VALUES + 30 }, (_, i) => `t${i}`);
    expect(normaliseLensFilters({ typeIds: many }).typeIds).toHaveLength(MAX_FACET_VALUES);
  });

  it('only accepts the two known scopes', () => {
    expect(normaliseLensFilters({ lens: 'Professional' }).lens).toBe('professional');
    expect(normaliseLensFilters({ lens: 'work' }).lens).toBeNull();
  });

  it('drops non-numeric community ids and truncates the rest', () => {
    expect(normaliseLensFilters({ communityIds: ['1', 'x', '2.7', '1'] }).communityIds).toEqual([1, 2]);
  });

  it('collapses a zero or negative confidence floor to "no floor"', () => {
    expect(normaliseLensFilters({ minConfidence: 0 }).minConfidence).toBeNull();
    expect(normaliseLensFilters({ minConfidence: -1 }).minConfidence).toBeNull();
    expect(normaliseLensFilters({ minConfidence: 'abc' }).minConfidence).toBeNull();
    expect(normaliseLensFilters({ minConfidence: 0.6 }).minConfidence).toBe(0.6);
  });

  it('clamps a confidence floor above 1', () => {
    expect(normaliseLensFilters({ minConfidence: 7 }).minConfidence).toBe(1);
  });

  it('trims and length-caps the query', () => {
    expect(normaliseLensFilters({ query: '  ibca  ' }).query).toBe('ibca');
    expect(normaliseLensFilters({ query: 'x'.repeat(MAX_QUERY_LENGTH + 50) }).query).toHaveLength(
      MAX_QUERY_LENGTH,
    );
  });
});

describe('isEmptyLensFilters / activeLensFilterCount', () => {
  it('recognises the empty filter', () => {
    expect(isEmptyLensFilters(EMPTY_LENS_FILTERS)).toBe(true);
    expect(activeLensFilterCount(EMPTY_LENS_FILTERS)).toBe(0);
  });

  it('counts each active facet once', () => {
    const f = filters({
      typeIds: ['a', 'b'],
      sources: ['web'],
      lens: 'personal',
      communityIds: [1],
      minConfidence: 0.5,
      query: 'x',
    });
    expect(isEmptyLensFilters(f)).toBe(false);
    expect(activeLensFilterCount(f)).toBe(6);
  });
});

// ── matchesLens ──────────────────────────────────────────────────────────────

describe('matchesLens — the empty lens', () => {
  it('matches everything, not nothing', () => {
    expect(matchesLens(entity(), EMPTY_LENS_FILTERS)).toBe(true);
    expect(matchesLens({ id: 'bare' }, EMPTY_LENS_FILTERS)).toBe(true);
    expect(
      matchesLens({ id: 'x', typeId: null, lens: null, confidenceScore: null, sources: [], community: null }, EMPTY_LENS_FILTERS),
    ).toBe(true);
  });
});

describe('matchesLens — type', () => {
  it('keeps a listed type and rejects the rest', () => {
    expect(matchesLens(entity({ typeId: 'org' }), filters({ typeIds: ['org', 'person'] }))).toBe(true);
    expect(matchesLens(entity({ typeId: 'place' }), filters({ typeIds: ['org'] }))).toBe(false);
  });

  it('rejects an entity with no type at all', () => {
    expect(matchesLens(entity({ typeId: null }), filters({ typeIds: ['org'] }))).toBe(false);
  });

  it('skips the filter when the caller never loaded the type', () => {
    expect(matchesLens({ id: 'x' }, filters({ typeIds: ['org'] }))).toBe(true);
  });
});

describe('matchesLens — scope', () => {
  it('matches on the scope column', () => {
    expect(matchesLens(entity({ lens: 'professional' }), filters({ lens: 'professional' }))).toBe(true);
    expect(matchesLens(entity({ lens: 'personal' }), filters({ lens: 'professional' }))).toBe(false);
  });

  it('rejects an unscoped entity', () => {
    expect(matchesLens(entity({ lens: null }), filters({ lens: 'personal' }))).toBe(false);
  });

  it('skips the filter when the scope was not loaded', () => {
    expect(matchesLens({ id: 'x' }, filters({ lens: 'personal' }))).toBe(true);
  });
});

describe('matchesLens — sources', () => {
  it('matches when any source overlaps', () => {
    expect(matchesLens(entity({ sources: ['gmail', 'web'] }), filters({ sources: ['web'] }))).toBe(true);
    expect(matchesLens(entity({ sources: ['gmail'] }), filters({ sources: ['web'] }))).toBe(false);
  });

  it('rejects an entity with a loaded but empty source list', () => {
    expect(matchesLens(entity({ sources: [] }), filters({ sources: ['web'] }))).toBe(false);
  });

  it('skips the filter when sources were not loaded', () => {
    expect(matchesLens({ id: 'x' }, filters({ sources: ['web'] }))).toBe(true);
  });
});

describe('matchesLens — community', () => {
  it('matches on membership', () => {
    expect(matchesLens(entity({ community: 3 }), filters({ communityIds: [1, 3] }))).toBe(true);
    expect(matchesLens(entity({ community: 2 }), filters({ communityIds: [1, 3] }))).toBe(false);
  });

  it('rejects an entity in no community', () => {
    expect(matchesLens(entity({ community: null }), filters({ communityIds: [0] }))).toBe(false);
  });

  it('treats community 0 as a real community, not as absent', () => {
    expect(matchesLens(entity({ community: 0 }), filters({ communityIds: [0] }))).toBe(true);
  });

  it('skips the filter when membership was not loaded', () => {
    expect(matchesLens({ id: 'x' }, filters({ communityIds: [0] }))).toBe(true);
  });
});

describe('matchesLens — confidence floor', () => {
  it('is inclusive at the floor', () => {
    expect(matchesLens(entity({ confidenceScore: 0.6 }), filters({ minConfidence: 0.6 }))).toBe(true);
    expect(matchesLens(entity({ confidenceScore: 0.59 }), filters({ minConfidence: 0.6 }))).toBe(false);
  });

  it('rejects an ungraded entity — absent evidence is not high confidence', () => {
    expect(matchesLens(entity({ confidenceScore: null }), filters({ minConfidence: 0.1 }))).toBe(false);
  });

  it('skips the filter when the score was not loaded', () => {
    expect(matchesLens({ id: 'x' }, filters({ minConfidence: 0.9 }))).toBe(true);
  });
});

describe('matchesLens — query', () => {
  it('matches name, summary and aliases case-insensitively', () => {
    expect(matchesLens(entity(), filters({ query: 'ibca' }))).toBe(true);
    expect(matchesLens(entity(), filters({ query: 'ARMS-LENGTH' }))).toBe(true);
    expect(matchesLens(entity(), filters({ query: 'compensation' }))).toBe(true);
    expect(matchesLens(entity(), filters({ query: 'railways' }))).toBe(false);
  });

  it('fails a candidate with no text to match', () => {
    expect(matchesLens({ id: 'x' }, filters({ query: 'anything' }))).toBe(false);
  });
});

describe('matchesLens — combinations', () => {
  it('ANDs every active filter', () => {
    const f = filters({ typeIds: ['org'], lens: 'professional', minConfidence: 0.5, query: 'ibca' });
    expect(matchesLens(entity(), f)).toBe(true);
    expect(matchesLens(entity({ lens: 'personal' }), f)).toBe(false);
    expect(matchesLens(entity({ confidenceScore: 0.2 }), f)).toBe(false);
    expect(matchesLens(entity({ typeId: 'person' }), f)).toBe(false);
    expect(matchesLens(entity({ name: 'Other', aliases: [], summary: null }), f)).toBe(false);
  });

  it('a partially-loaded candidate only fails on filters it can answer', () => {
    const f = filters({ typeIds: ['org'], communityIds: [9], sources: ['gmail'] });
    expect(matchesLens({ id: 'x', typeId: 'org' }, f)).toBe(true);
    expect(matchesLens({ id: 'x', typeId: 'person' }, f)).toBe(false);
  });
});

// ── buildLensFilter ──────────────────────────────────────────────────────────

describe('buildLensFilter', () => {
  it('always excludes merged entities, even with no filters', () => {
    const plan = buildLensFilter(EMPTY_LENS_FILTERS);
    expect(plan.empty).toBe(true);
    expect(plan.conditions).toHaveLength(1);
    expect(plan.needsAnalysis).toBe(false);
  });

  it('adds one condition per SQL-expressible facet', () => {
    const plan = buildLensFilter(
      filters({ typeIds: ['org'], lens: 'personal', minConfidence: 0.4, query: 'x', sources: ['web'] }),
    );
    // merged-guard + type + scope + confidence + query + sources
    expect(plan.conditions).toHaveLength(6);
    expect(plan.empty).toBe(false);
  });

  it('hands the community facet back separately rather than faking a WHERE clause', () => {
    const plan = buildLensFilter(filters({ communityIds: [2, 5] }));
    expect(plan.conditions).toHaveLength(1);
    expect(plan.needsAnalysis).toBe(true);
    expect(plan.communityIds).toEqual([2, 5]);
  });

  it('exposes the same decision in memory as it asks of SQL', () => {
    const plan = buildLensFilter(filters({ typeIds: ['org'] }));
    expect(plan.matches(entity({ typeId: 'org' }))).toBe(true);
    expect(plan.matches(entity({ typeId: 'person' }))).toBe(false);
  });
});

describe('describeLensFilters', () => {
  it('says "everything" for an empty lens', () => {
    expect(describeLensFilters(EMPTY_LENS_FILTERS)).toBe('everything');
  });

  it('summarises each active facet', () => {
    const text = describeLensFilters(filters({ lens: 'personal', typeIds: ['a', 'b'], query: 'boat' }));
    expect(text).toContain('personal');
    expect(text).toContain('2 types');
    expect(text).toContain('boat');
  });
});

// ── lensGrowth ───────────────────────────────────────────────────────────────

describe('lensGrowth', () => {
  it('reports no delta on the first run', () => {
    expect(lensGrowth(12, null)).toMatchObject({ count: 12, previousCount: null, delta: 0, grew: false, firstRun: true });
    expect(lensGrowth(12, undefined).firstRun).toBe(true);
  });

  it('reports growth and shrinkage against the stored count', () => {
    expect(lensGrowth(12, 9)).toMatchObject({ delta: 3, grew: true, firstRun: false });
    expect(lensGrowth(7, 9)).toMatchObject({ delta: -2, grew: false });
    expect(lensGrowth(9, 9)).toMatchObject({ delta: 0, grew: false });
  });

  it('treats a zero baseline as a real baseline, not a first run', () => {
    expect(lensGrowth(3, 0)).toMatchObject({ previousCount: 0, delta: 3, grew: true, firstRun: false });
  });

  it('never returns a negative or fractional count', () => {
    expect(lensGrowth(-5, 2).count).toBe(0);
    expect(lensGrowth(Number.NaN, 2).count).toBe(0);
    expect(lensGrowth(3.7, null).count).toBe(3);
  });
});

// ── Time range ───────────────────────────────────────────────────────────────

const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe('range parsing', () => {
  it('parses a date input to UTC midnight and back', () => {
    expect(parseDateInput('2026-07-04')).toBe(D('2026-07-04'));
    expect(toDateInput(D('2026-07-04'))).toBe('2026-07-04');
    expect(toDateInput(null)).toBe('');
  });

  it('treats blank or unparseable input as unbounded', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput('not a date')).toBeNull();
  });

  it('makes the typed end date inclusive of that whole day', () => {
    const range = parseRangeInputs('2026-07-01', '2026-07-07');
    expect(range.start).toBe(D('2026-07-01'));
    expect(range.end).toBe(D('2026-07-07') + DAY_MS - 1);
    expect(eventInRange({ id: 'e', date: '2026-07-07' }, range)).toBe(true);
  });

  it('accepts a half-open range from one field', () => {
    expect(parseRangeInputs('2026-07-01', '')).toEqual({ start: D('2026-07-01'), end: null });
    expect(parseRangeInputs('', '')).toEqual(FULL_RANGE);
  });

  it('swaps inverted bounds — dragging right-to-left is the same selection', () => {
    expect(normaliseRange({ start: 200, end: 100 })).toEqual({ start: 100, end: 200 });
    expect(normaliseRange({ start: null, end: 100 })).toEqual({ start: null, end: 100 });
  });

  it('recognises the unbounded range', () => {
    expect(isFullRange(FULL_RANGE)).toBe(true);
    expect(isFullRange({ start: 0, end: null })).toBe(false);
  });
});

describe('eventTime', () => {
  it('reads a bare date as UTC so it lands on the same axis as the brush', () => {
    expect(eventTime('2026-07-04')).toBe(D('2026-07-04'));
  });

  it('reads a full ISO stamp', () => {
    expect(eventTime('2026-07-04T12:00:00Z')).toBe(D('2026-07-04') + 12 * 3600_000);
  });

  it('returns null for junk', () => {
    expect(eventTime('someday')).toBeNull();
    expect(eventTime('')).toBeNull();
    expect(eventTime(null)).toBeNull();
  });
});

describe('eventInRange', () => {
  const point: TimelinePoint = { id: 'a', date: '2026-07-10' };

  it('is inclusive at both ends', () => {
    expect(eventInRange(point, { start: D('2026-07-10'), end: D('2026-07-20') })).toBe(true);
    expect(eventInRange(point, { start: D('2026-07-01'), end: D('2026-07-10') })).toBe(true);
    expect(eventInRange(point, { start: D('2026-07-11'), end: D('2026-07-20') })).toBe(false);
    expect(eventInRange(point, { start: D('2026-07-01'), end: D('2026-07-09') })).toBe(false);
  });

  it('honours a half-open range', () => {
    expect(eventInRange(point, { start: D('2026-07-01'), end: null })).toBe(true);
    expect(eventInRange(point, { start: null, end: D('2026-07-01') })).toBe(false);
  });

  it('overlaps a spanning event whose endpoints both sit outside the range', () => {
    const span: TimelinePoint = { id: 'b', date: '2026-01-01', dateEnd: '2026-12-31' };
    expect(eventInRange(span, { start: D('2026-07-01'), end: D('2026-07-07') })).toBe(true);
  });

  it('handles a reversed dateEnd without dropping the event', () => {
    const backwards: TimelinePoint = { id: 'c', date: '2026-07-10', dateEnd: '2026-07-01' };
    expect(eventInRange(backwards, { start: D('2026-07-05'), end: D('2026-07-06') })).toBe(true);
  });

  it('drops an event with an unparseable date', () => {
    expect(eventInRange({ id: 'd', date: 'whenever' }, FULL_RANGE)).toBe(false);
  });
});

describe('eventsInRange / entityIdsInRange', () => {
  const events: TimelinePoint[] = [
    { id: '1', date: '2026-07-01', entityId: 'a' },
    { id: '2', date: '2026-07-15', entityId: 'b' },
    { id: '3', date: '2026-07-16', entityId: 'b' },
    { id: '4', date: '2026-08-01', entityId: 'c' },
    { id: '5', date: '2026-07-15', entityId: null },
  ];

  it('returns the original list untouched for an unbounded range', () => {
    expect(eventsInRange(events, FULL_RANGE)).toBe(events);
  });

  it('filters to the brushed window', () => {
    const ids = eventsInRange(events, { start: D('2026-07-10'), end: D('2026-07-20') }).map((e) => e.id);
    expect(ids).toEqual(['2', '3', '5']);
  });

  it('reports the distinct entity ids a range implicates, in order', () => {
    expect(entityIdsInRange(events, FULL_RANGE)).toEqual(['a', 'b', 'c']);
    expect(entityIdsInRange(events, { start: D('2026-07-10'), end: D('2026-07-20') })).toEqual(['b']);
  });

  it('returns no entity ids for an empty window rather than falling back to all', () => {
    expect(entityIdsInRange(events, { start: D('2026-09-01'), end: D('2026-09-02') })).toEqual([]);
  });
});

describe('eventExtent', () => {
  it('spans the earliest start to the latest end', () => {
    const extent = eventExtent([
      { id: '1', date: '2026-07-01' },
      { id: '2', date: '2026-07-05', dateEnd: '2026-09-01' },
    ]);
    expect(extent).toEqual({ start: D('2026-07-01'), end: D('2026-09-01') });
  });

  it('pads a single-day extent so the scale does not collapse', () => {
    const extent = eventExtent([{ id: '1', date: '2026-07-01' }]);
    expect(extent.end! - extent.start!).toBe(DAY_MS);
  });

  it('returns an unbounded extent when nothing is dateable', () => {
    expect(eventExtent([])).toEqual(FULL_RANGE);
    expect(eventExtent([{ id: '1', date: 'nope' }])).toEqual(FULL_RANGE);
  });
});

// ── Slugs ────────────────────────────────────────────────────────────────────

describe('slugify / nextFreeSlug', () => {
  it('produces a hyphenated slug and never an empty one', () => {
    expect(slugify('Work — DfE & Policy')).toBe('work-dfe-policy');
    expect(slugify('!!!')).toBe('lens');
    expect(slugify('')).toBe('lens');
  });

  it('returns the base when it is free', () => {
    expect(nextFreeSlug('work', [])).toBe('work');
  });

  it('suffixes past every taken slug', () => {
    expect(nextFreeSlug('work', ['work'])).toBe('work-2');
    expect(nextFreeSlug('work', ['work', 'work-2', 'work-3'])).toBe('work-4');
  });
});

describe('cluster keys', () => {
  it('an empty lens still matches everything', () => {
    expect(matchesLens({ id: 'e1', clusterKey: 'anything' }, EMPTY_LENS_FILTERS)).toBe(true);
  });

  it('keeps an entity in one of the named clusters', () => {
    const filters = { ...EMPTY_LENS_FILTERS, clusterKeys: ['abc', 'def'] };
    expect(matchesLens({ id: 'e1', clusterKey: 'abc' }, filters)).toBe(true);
  });

  it('rejects an entity in a cluster the lens does not name', () => {
    const filters = { ...EMPTY_LENS_FILTERS, clusterKeys: ['abc'] };
    expect(matchesLens({ id: 'e1', clusterKey: 'zzz' }, filters)).toBe(false);
  });

  it('rejects an entity in no cluster at all', () => {
    const filters = { ...EMPTY_LENS_FILTERS, clusterKeys: ['abc'] };
    expect(matchesLens({ id: 'e1', clusterKey: null }, filters)).toBe(false);
  });

  it('skips the filter when the caller never loaded a cluster key', () => {
    // Absent evidence skips; answering an unanswerable question with "no" would
    // empty the view for a reason nobody can see. Rule 2 in the module header.
    const filters = { ...EMPTY_LENS_FILTERS, clusterKeys: ['abc'] };
    expect(matchesLens({ id: 'e1', name: 'thing' }, filters)).toBe(true);
  });

  it('counts as one active facet and reads as clusters', () => {
    const filters = { ...EMPTY_LENS_FILTERS, clusterKeys: ['a', 'b'] };
    expect(activeLensFilterCount(filters)).toBe(1);
    expect(describeLensFilters(filters)).toContain('2 clusters');
    expect(isEmptyLensFilters(filters)).toBe(false);
  });

  it('parses cluster keys off a stored lens', () => {
    expect(normaliseLensFilters({ clusterKeys: ['a', 'b'] }).clusterKeys).toEqual(['a', 'b']);
  });

  it('still parses a lens saved before cluster keys existed', () => {
    const parsed = normaliseLensFilters({ communityIds: [3] });
    expect(parsed.clusterKeys).toEqual([]);
    expect(parsed.communityIds).toEqual([3]);
  });
});
