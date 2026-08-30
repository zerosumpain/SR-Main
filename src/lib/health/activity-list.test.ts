import { describe, expect, it } from 'vitest';
import type { Highlight } from '$lib/trails/highlights';
import {
  buildComparator,
  buildFilterPredicate,
  clearColumnFilter,
  countTypes,
  describeFilters,
  emptyFilters,
  encodeRange,
  filtersToQuery,
  formatRange,
  isColumnFiltered,
  numericValue,
  parseFilters,
  parseRange,
  parseSort,
  placePopover,
  rowWindow,
  sortValue,
  totalsOf,
  validDay,
  POP_WIDTH,
  ROWS_PER_PAGE,
  type ActivityFilters,
  type AnchorRect,
  type FilterableRow,
} from './activity-list';

function highlight(partial: Partial<Highlight> = {}): Highlight {
  return {
    kind: 'segment_rank',
    scope: 'segment',
    rank: 1,
    outOf: 12,
    label: 'Fastest ever',
    detail: 'of 12 efforts on Mill Lane',
    weight: 90,
    ...partial,
  };
}

let seq = 0;
function row(partial: Partial<FilterableRow> = {}): FilterableRow {
  seq += 1;
  return {
    id: `a${seq}`,
    name: 'Morning run',
    activityType: 'run',
    startDate: 1_700_000_000,
    startDateLocal: '2023-11-14 08:13:00',
    distanceM: 10_000,
    durationS: 3000,
    activeDurationS: 2_700,
    elevationGainM: 120,
    avgHeartrate: 150,
    avgPaceSPerKm: 270,
    temperatureC: 11.5,
    efficiencyFactor: 1.23,
    segmentCount: 3,
    highlight: null,
    ...partial,
  };
}

describe('numericValue', () => {
  it('reads every numeric column in the unit its filter box is typed in', () => {
    const r = row();
    expect(numericValue(r, 'distance')).toBe(10);
    expect(numericValue(r, 'time')).toBe(45);
    expect(numericValue(r, 'pace')).toBe(4.5);
    expect(numericValue(r, 'climb')).toBe(120);
    expect(numericValue(r, 'hr')).toBe(150);
    expect(numericValue(r, 'temp')).toBe(11.5);
    expect(numericValue(r, 'ef')).toBe(1.23);
    expect(numericValue(r, 'segments')).toBe(3);
  });

  it('prefers moving time and falls back to elapsed', () => {
    expect(numericValue(row({ activeDurationS: 600, durationS: 900 }), 'time')).toBe(10);
    expect(numericValue(row({ activeDurationS: null, durationS: 900 }), 'time')).toBe(15);
  });

  it('reads a missing or nonsensical reading as unknown, not as zero', () => {
    expect(numericValue(row({ distanceM: null }), 'distance')).toBeNull();
    expect(numericValue(row({ avgHeartrate: 0 }), 'hr')).toBeNull();
    expect(numericValue(row({ avgPaceSPerKm: 0 }), 'pace')).toBeNull();
    expect(numericValue(row({ temperatureC: null }), 'temp')).toBeNull();
    // EF is null for every non-pace sport by construction in the service.
    expect(numericValue(row({ activityType: 'ride', efficiencyFactor: null }), 'ef')).toBeNull();
  });

  it('counts a zero temperature as a real reading', () => {
    expect(numericValue(row({ temperatureC: 0 }), 'temp')).toBe(0);
  });
});

describe('sortValue', () => {
  it('sorts date on the epoch and text case-insensitively', () => {
    expect(sortValue(row({ startDate: 42 }), 'date')).toBe(42);
    expect(sortValue(row({ name: 'Zermatt Loop' }), 'name')).toBe('zermatt loop');
    expect(sortValue(row({ activityType: 'trail_run' }), 'type')).toBe('trail run');
  });

  it('sorts excellence on the ranker’s own weight, and blanks are unknown', () => {
    expect(sortValue(row({ highlight: highlight({ weight: 7 }) }), 'excellence')).toBe(7);
    expect(sortValue(row({ highlight: null }), 'excellence')).toBeNull();
  });
});

describe('buildComparator', () => {
  it('defaults to newest first', () => {
    const older = row({ id: 'old', startDate: 100 });
    const newer = row({ id: 'new', startDate: 200 });
    expect([older, newer].sort(buildComparator(null)).map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('sinks nulls to the bottom in BOTH directions', () => {
    const rows = [
      row({ id: 'blank', avgHeartrate: null }),
      row({ id: 'low', avgHeartrate: 120 }),
      row({ id: 'high', avgHeartrate: 180 }),
    ];
    expect([...rows].sort(buildComparator({ key: 'hr', dir: 'asc' })).map((r) => r.id)).toEqual([
      'low',
      'high',
      'blank',
    ]);
    expect([...rows].sort(buildComparator({ key: 'hr', dir: 'desc' })).map((r) => r.id)).toEqual([
      'high',
      'low',
      'blank',
    ]);
  });

  it('never drops the unrankable rows', () => {
    const rows = [row({ id: 'a', efficiencyFactor: null }), row({ id: 'b', efficiencyFactor: 1.1 })];
    expect([...rows].sort(buildComparator({ key: 'ef', dir: 'desc' }))).toHaveLength(2);
  });

  it('sorts pace ascending as fastest first', () => {
    const quick = row({ id: 'quick', avgPaceSPerKm: 240 });
    const slow = row({ id: 'slow', avgPaceSPerKm: 400 });
    expect([slow, quick].sort(buildComparator({ key: 'pace', dir: 'asc' })).map((r) => r.id)).toEqual([
      'quick',
      'slow',
    ]);
  });

  it('breaks ties by recency so the order is stable', () => {
    const rows = [
      row({ id: 'old', segmentCount: 2, startDate: 100 }),
      row({ id: 'new', segmentCount: 2, startDate: 200 }),
    ];
    expect([...rows].sort(buildComparator({ key: 'segments', dir: 'asc' })).map((r) => r.id)).toEqual(
      ['new', 'old'],
    );
  });
});

describe('buildFilterPredicate', () => {
  function filters(patch: (f: ActivityFilters) => void): ActivityFilters {
    const f = emptyFilters();
    patch(f);
    return f;
  }

  it('passes everything when nothing is set', () => {
    const keep = buildFilterPredicate(emptyFilters());
    expect(keep(row())).toBe(true);
    expect(keep(row({ distanceM: null, avgHeartrate: null, highlight: null }))).toBe(true);
  });

  it('filters types as a set, empty meaning all', () => {
    const keep = buildFilterPredicate(filters((f) => (f.types = ['ride', 'mtb'])));
    expect(keep(row({ activityType: 'ride' }))).toBe(true);
    expect(keep(row({ activityType: 'run' }))).toBe(false);
  });

  it('bounds dates on the LOCAL day, inclusive at both ends', () => {
    const keep = buildFilterPredicate(
      filters((f) => {
        f.from = '2023-11-14';
        f.to = '2023-11-14';
      }),
    );
    expect(keep(row({ startDateLocal: '2023-11-14 08:13:00' }))).toBe(true);
    // 23:40 local on the 14th is the 15th in UTC; reading it through a Date is
    // exactly how an evening run leaves its own day.
    expect(keep(row({ startDateLocal: '2023-11-14 23:40:00' }))).toBe(true);
    expect(keep(row({ startDateLocal: '2023-11-15 00:10:00' }))).toBe(false);
    expect(keep(row({ startDateLocal: '2023-11-13 09:00:00' }))).toBe(false);
  });

  it('applies numeric bounds inclusively', () => {
    const keep = buildFilterPredicate(
      filters((f) => (f.ranges.distance = { min: 5, max: 10 })),
    );
    expect(keep(row({ distanceM: 5_000 }))).toBe(true);
    expect(keep(row({ distanceM: 10_000 }))).toBe(true);
    expect(keep(row({ distanceM: 4_999 }))).toBe(false);
    expect(keep(row({ distanceM: 10_001 }))).toBe(false);
  });

  it('drops a row whose value is unknown from an ACTIVE numeric filter', () => {
    const keep = buildFilterPredicate(filters((f) => (f.ranges.hr = { min: 150, max: null })));
    expect(keep(row({ avgHeartrate: null }))).toBe(false);
    expect(keep(row({ avgHeartrate: 160 }))).toBe(true);
  });

  it('matches names and excellence case-insensitively, on a substring', () => {
    const byName = buildFilterPredicate(filters((f) => (f.name = 'MORNING')));
    expect(byName(row({ name: 'Early morning run' }))).toBe(true);
    expect(byName(row({ name: 'Evening loop' }))).toBe(false);

    const byExcellence = buildFilterPredicate(filters((f) => (f.excellence = 'mill lane')));
    expect(byExcellence(row({ highlight: highlight() }))).toBe(true);
    expect(byExcellence(row({ highlight: highlight({ detail: 'hottest of the year' }) }))).toBe(
      false,
    );
    expect(byExcellence(row({ highlight: null }))).toBe(false);
  });

  it('ANDs every active filter', () => {
    const keep = buildFilterPredicate(
      filters((f) => {
        f.types = ['run'];
        f.ranges.distance = { min: 8, max: null };
      }),
    );
    expect(keep(row({ activityType: 'run', distanceM: 9_000 }))).toBe(true);
    expect(keep(row({ activityType: 'run', distanceM: 3_000 }))).toBe(false);
    expect(keep(row({ activityType: 'ride', distanceM: 9_000 }))).toBe(false);
  });
});

describe('countTypes', () => {
  it('counts the distinct types present in the LOADED rows, busiest first', () => {
    const rows = [
      row({ activityType: 'run' }),
      row({ activityType: 'run' }),
      row({ activityType: 'ride' }),
      row({ activityType: 'trail_run' }),
    ];
    expect(countTypes(rows)).toEqual([
      { activityType: 'run', label: 'Run', count: 2 },
      { activityType: 'ride', label: 'Ride', count: 1 },
      { activityType: 'trail_run', label: 'Trail run', count: 1 },
    ]);
  });

  it('is empty for an empty list', () => {
    expect(countTypes([])).toEqual([]);
  });
});

describe('totalsOf', () => {
  it('sums the rows it is given and treats a missing reading as nothing', () => {
    const rows = [
      row({ distanceM: 10_000, durationS: 3_600, elevationGainM: 100 }),
      row({ distanceM: null, durationS: 1_800, elevationGainM: null }),
    ];
    expect(totalsOf(rows)).toEqual({
      count: 2,
      distanceM: 10_000,
      durationS: 5_400,
      elevationGainM: 100,
    });
  });

  it('is all zeroes when the filter matches nothing', () => {
    expect(totalsOf([])).toEqual({ count: 0, distanceM: 0, durationS: 0, elevationGainM: 0 });
  });
});

describe('range encoding', () => {
  it('round-trips through the URL', () => {
    for (const range of [
      { min: 2, max: 10 },
      { min: 2, max: null },
      { min: null, max: 10 },
      { min: -5.5, max: 0 },
    ]) {
      expect(parseRange(encodeRange(range))).toEqual(range);
    }
  });

  it('encodes an empty range as absent', () => {
    expect(encodeRange({ min: null, max: null })).toBeNull();
  });

  it('falls back to unfiltered on anything it cannot read', () => {
    const off = { min: null, max: null };
    expect(parseRange(null)).toEqual(off);
    expect(parseRange('')).toEqual(off);
    expect(parseRange('nonsense')).toEqual(off);
    expect(parseRange('1..2..3')).toEqual(off);
    // Half a range that is not a number turns the WHOLE filter off rather than
    // silently applying a bound nobody typed.
    expect(parseRange('abc..5')).toEqual(off);
    expect(parseRange('..')).toEqual(off);
  });

  it('formats a range for a chip', () => {
    expect(formatRange({ min: 2, max: 10 })).toBe('2–10');
    expect(formatRange({ min: 2, max: null })).toBe('≥ 2');
    expect(formatRange({ min: null, max: 10 })).toBe('≤ 10');
    expect(formatRange({ min: null, max: null })).toBe('');
  });
});

describe('validDay', () => {
  it('accepts a calendar day and nothing else', () => {
    expect(validDay('2026-08-21')).toBe('2026-08-21');
    expect(validDay(' 2026-08-21 ')).toBe('2026-08-21');
    expect(validDay('2026-8-21')).toBeNull();
    expect(validDay('yesterday')).toBeNull();
    expect(validDay(null)).toBeNull();
  });
});

describe('URL seeding', () => {
  const known = ['run', 'ride', 'hike'];

  it('seeds every filter from the query string', () => {
    const f = parseFilters(
      new URLSearchParams('type=run,ride&from=2026-01-01&to=2026-02-01&q=loop&x=fastest&distance=5..20&hr=..160'),
      known,
    );
    expect(f.types).toEqual(['run', 'ride']);
    expect(f.from).toBe('2026-01-01');
    expect(f.to).toBe('2026-02-01');
    expect(f.name).toBe('loop');
    expect(f.excellence).toBe('fastest');
    expect(f.ranges.distance).toEqual({ min: 5, max: 20 });
    expect(f.ranges.hr).toEqual({ min: null, max: 160 });
  });

  it('drops a type that is not in the loaded rows rather than emptying the table', () => {
    const f = parseFilters(new URLSearchParams('type=run,kayak,all'), known);
    expect(f.types).toEqual(['run']);
  });

  it('ignores an unreadable date bound', () => {
    const f = parseFilters(new URLSearchParams('from=last-tuesday'), known);
    expect(f.from).toBeNull();
  });

  it('only accepts a sort on a real column', () => {
    expect(parseSort(new URLSearchParams('sort=pace&dir=asc'))).toEqual({ key: 'pace', dir: 'asc' });
    expect(parseSort(new URLSearchParams('sort=pace'))).toEqual({ key: 'pace', dir: 'desc' });
    expect(parseSort(new URLSearchParams('sort=vibes'))).toBeNull();
    expect(parseSort(new URLSearchParams())).toBeNull();
  });

  it('writes back only what is actually set, and round-trips', () => {
    const f = emptyFilters();
    expect(filtersToQuery(f, null)).toBe('');

    f.types = ['run'];
    f.ranges.climb = { min: null, max: 300 };
    f.name = '  loop  ';
    const query = filtersToQuery(f, { key: 'climb', dir: 'asc' });
    const back = parseFilters(new URLSearchParams(query), ['run']);
    expect(back.types).toEqual(['run']);
    expect(back.ranges.climb).toEqual({ min: null, max: 300 });
    expect(back.name).toBe('loop');
    expect(parseSort(new URLSearchParams(query))).toEqual({ key: 'climb', dir: 'asc' });
  });
});

describe('chips', () => {
  it('is empty when nothing is filtered', () => {
    expect(describeFilters(emptyFilters())).toEqual([]);
  });

  it('gives every selected type its own removable chip', () => {
    const f = emptyFilters();
    f.types = ['run', 'ride'];
    const chips = describeFilters(f);
    expect(chips.map((c) => c.id)).toEqual(['type:run', 'type:ride']);
    expect(chips.map((c) => c.value)).toEqual(['run', 'ride']);
    expect(chips[0].label).toBe('Type Run');
  });

  it('labels a numeric chip with its column and unit', () => {
    const f = emptyFilters();
    f.ranges.pace = { min: 4, max: 6 };
    expect(describeFilters(f)[0].label).toBe('Pace 4–6 min/km');
  });

  it('collapses a date range into one chip', () => {
    const f = emptyFilters();
    f.from = '2026-01-01';
    expect(describeFilters(f)).toHaveLength(1);
    f.to = '2026-02-01';
    expect(describeFilters(f)).toHaveLength(1);
  });

  it('ignores whitespace-only searches', () => {
    const f = emptyFilters();
    f.name = '   ';
    f.excellence = '  ';
    expect(describeFilters(f)).toEqual([]);
  });
});

describe('placePopover', () => {
  const SCREEN = { width: 1440, height: 900 };

  /** A trigger rect, in viewport coordinates. */
  function trigger(partial: Partial<AnchorRect> = {}): AnchorRect {
    return { left: 400, right: 480, top: 200, bottom: 224, ...partial };
  }

  it('sits just below the trigger and left-aligned when there is room', () => {
    const p = placePopover(trigger(), SCREEN, { height: 300 });
    expect(p.flipped).toBe(false);
    expect(p.left).toBe(400);
    expect(p.top).toBeGreaterThanOrEqual(224);
    expect(p.top).toBeLessThanOrEqual(232);
    expect(p.top + 300).toBeLessThanOrEqual(SCREEN.height);
  });

  it('flips above the trigger for a row at the bottom of a long table', () => {
    // The defect this exists for: row 900 of 1,136 has its "···" button near
    // the bottom of the screen, so the panel used to open under the fold.
    const p = placePopover(trigger({ top: 860, bottom: 884 }), SCREEN, { height: 300 });
    expect(p.flipped).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + 300).toBeLessThanOrEqual(860);
  });

  it('never lets the panel run off the bottom, even unflipped', () => {
    for (const top of [0, 120, 400, 700, 860, 899]) {
      const p = placePopover(trigger({ top, bottom: top + 24 }), SCREEN, { height: 400 });
      const used = Math.min(400, p.maxHeight);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top + used).toBeLessThanOrEqual(SCREEN.height);
    }
  });

  it('clamps a trigger near the right edge back onto the screen', () => {
    const p = placePopover(trigger({ left: 1400, right: 1430 }), SCREEN, { height: 200 });
    expect(p.left + POP_WIDTH).toBeLessThanOrEqual(SCREEN.width);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it('clamps a trigger that the sideways scroll has pushed off the left edge', () => {
    const p = placePopover(trigger({ left: -260, right: -180 }), SCREEN, { height: 200 });
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left).toBeLessThan(20);
  });

  it('hangs an end-aligned panel off the trigger’s right edge', () => {
    const p = placePopover(trigger({ left: 1000, right: 1040 }), SCREEN, {
      height: 200,
      align: 'end',
    });
    expect(p.left + POP_WIDTH).toBe(1040);
  });

  it('caps the height to the room it has rather than overflowing', () => {
    const tall = placePopover(trigger({ top: 700, bottom: 724 }), SCREEN, { height: 2000 });
    expect(tall.maxHeight).toBeLessThanOrEqual(SCREEN.height);
    expect(tall.maxHeight).toBeGreaterThan(0);
  });

  it('keeps a panel on a tiny screen visible rather than shrinking it to nothing', () => {
    const tiny = { width: 320, height: 320 };
    const p = placePopover(trigger({ left: 200, right: 260, top: 250, bottom: 274 }), tiny, {
      height: 400,
    });
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.maxHeight).toBeGreaterThanOrEqual(100);
  });

  it('is pure — the same rect places the same way twice', () => {
    const rect = trigger({ top: 500, bottom: 524 });
    expect(placePopover(rect, SCREEN, { height: 260 })).toEqual(
      placePopover(rect, SCREEN, { height: 260 }),
    );
  });
});

describe('rowWindow', () => {
  it('renders a page of the matching rows and says how many are left', () => {
    const w = rowWindow(ROWS_PER_PAGE, 1_136);
    expect(w.shown).toBe(ROWS_PER_PAGE);
    expect(w.matching).toBe(1_136);
    expect(w.remaining).toBe(1_136 - ROWS_PER_PAGE);
    expect(w.nextStep).toBe(ROWS_PER_PAGE);
  });

  it('never claims to show more rows than match', () => {
    const w = rowWindow(ROWS_PER_PAGE, 12);
    expect(w.shown).toBe(12);
    expect(w.remaining).toBe(0);
    expect(w.nextStep).toBe(0);
  });

  it('shortens the last step to what is actually left', () => {
    expect(rowWindow(100, 130, 100).nextStep).toBe(30);
  });

  it('handles an empty match set and a nonsense cap', () => {
    expect(rowWindow(100, 0)).toEqual({ shown: 0, matching: 0, remaining: 0, nextStep: 0 });
    expect(rowWindow(-5, 40).shown).toBe(0);
  });
});

describe('isColumnFiltered / clearColumnFilter', () => {
  it('reports and clears each kind of column', () => {
    const f = emptyFilters();
    f.from = '2026-01-01';
    f.types = ['run'];
    f.name = 'loop';
    f.excellence = 'fastest';
    f.ranges.temp = { min: 20, max: null };

    for (const key of ['date', 'type', 'name', 'excellence', 'temp'] as const) {
      expect(isColumnFiltered(f, key)).toBe(true);
      clearColumnFilter(f, key);
      expect(isColumnFiltered(f, key)).toBe(false);
    }
    expect(describeFilters(f)).toEqual([]);
  });

  it('leaves the other columns alone', () => {
    const f = emptyFilters();
    f.ranges.distance = { min: 5, max: null };
    f.ranges.climb = { min: 100, max: null };
    clearColumnFilter(f, 'distance');
    expect(isColumnFiltered(f, 'climb')).toBe(true);
  });
});
