import { describe, it, expect } from 'vitest';
import {
  summariseViews,
  formatDwell,
  BOUNCE_DWELL_MS,
  BOUNCE_SCROLL_PCT,
  UNKNOWN_DEVICE,
  type ViewRow,
} from './analytics';

// Defaults chosen to be inert: every field is far from a threshold, so a test
// that cares about one dimension only has to state that dimension.
function row(overrides: Partial<ViewRow> = {}): ViewRow {
  return {
    dwellMs: 60_000,
    maxScrollPct: 80,
    completed: false,
    referrerHost: null,
    deviceClass: 'desktop',
    createdAt: new Date('2026-08-01T12:00:00Z'),
    ...overrides,
  };
}

describe('summariseViews — the empty window', () => {
  // The bug this file exists to prevent: 0/0 is NaN, NaN reaches the card as
  // the string 'NaN%', and nothing anywhere reports an error.
  it('returns zeros and never NaN for no rows', () => {
    const s = summariseViews([]);
    expect(s).toEqual({
      reads: 0,
      medianDwellMs: 0,
      meanDwellMs: 0,
      completionRate: 0,
      medianScrollPct: 0,
      bounceRate: 0,
      byDevice: [],
      topReferrers: [],
      daily: [],
    });
    for (const [key, value] of Object.entries(s)) {
      if (typeof value === 'number') expect(Number.isNaN(value), `${key} is NaN`).toBe(false);
    }
  });

  it('survives a corrupt row without NaN-ing every headline', () => {
    const s = summariseViews([row({ dwellMs: Number.NaN }), row({ dwellMs: 4000 })]);
    // The row still counts as a read; only the numeric summaries ignore it.
    expect(s.reads).toBe(2);
    expect(s.medianDwellMs).toBe(4000);
    expect(s.meanDwellMs).toBe(4000);
    expect(Number.isNaN(s.medianDwellMs)).toBe(false);
    expect(Number.isNaN(s.meanDwellMs)).toBe(false);
  });
});

describe('summariseViews — median is the headline, not the mean', () => {
  // One tab left open for an hour against four honest reads. If medianDwellMs
  // were ever quietly computed as a mean this assertion is off by 240x.
  it('reports a median unmoved by a single hour-long tab', () => {
    const dwells = [1000, 2000, 3000, 4000, 3_600_000];
    const s = summariseViews(dwells.map((dwellMs) => row({ dwellMs })));
    expect(s.medianDwellMs).toBe(3000);
    expect(s.meanDwellMs).toBe(722_000);
  });

  it('averages the two middle values on an even count', () => {
    const s = summariseViews([1000, 2000, 3000, 10_000].map((dwellMs) => row({ dwellMs })));
    // Upper-middle-only would give 3000; lower-middle-only 2000.
    expect(s.medianDwellMs).toBe(2500);
    expect(s.meanDwellMs).toBe(4000);
  });

  it('rounds a half-millisecond median to a whole millisecond', () => {
    const s = summariseViews([100, 201].map((dwellMs) => row({ dwellMs })));
    expect(s.medianDwellMs).toBe(151);
  });

  it('is order-independent', () => {
    const values = [9000, 1000, 5000, 3000, 7000];
    const forwards = summariseViews(values.map((dwellMs) => row({ dwellMs })));
    const backwards = summariseViews([...values].reverse().map((dwellMs) => row({ dwellMs })));
    expect(forwards.medianDwellMs).toBe(5000);
    expect(backwards.medianDwellMs).toBe(5000);
  });

  it('sorts numerically, not lexicographically', () => {
    // String sort would order these 1000, 200000, 30000 and pick 200000.
    const s = summariseViews([1000, 200_000, 30_000].map((dwellMs) => row({ dwellMs })));
    expect(s.medianDwellMs).toBe(30_000);
  });

  it('takes the median of scroll depth too', () => {
    // Skewed on purpose: the mean of these is 33, so a mean/median swap here
    // cannot hide behind a symmetric sample.
    const s = summariseViews([5, 10, 15, 100].map((maxScrollPct) => row({ maxScrollPct })));
    expect(s.medianScrollPct).toBe(13);
  });

  it('does not mutate or reorder the caller array', () => {
    const rows = [row({ dwellMs: 9000 }), row({ dwellMs: 1000 }), row({ dwellMs: 5000 })];
    const before = rows.map((r) => r.dwellMs);
    summariseViews(rows);
    expect(rows.map((r) => r.dwellMs)).toEqual(before);
  });
});

describe('summariseViews — rates', () => {
  it('computes completion as a fraction of all reads', () => {
    const s = summariseViews([
      row({ completed: true }),
      row({ completed: true }),
      row({ completed: false }),
      row({ completed: false }),
      row({ completed: false }),
    ]);
    expect(s.reads).toBe(5);
    expect(s.completionRate).toBeCloseTo(0.4, 10);
  });

  it('counts a bounce only when it is BOTH brief and shallow', () => {
    const s = summariseViews([
      row({ dwellMs: BOUNCE_DWELL_MS - 1, maxScrollPct: BOUNCE_SCROLL_PCT - 1 }), // bounce
      row({ dwellMs: BOUNCE_DWELL_MS, maxScrollPct: BOUNCE_SCROLL_PCT - 1 }), // brief? no
      row({ dwellMs: BOUNCE_DWELL_MS - 1, maxScrollPct: BOUNCE_SCROLL_PCT }), // shallow? no
      row({ dwellMs: 120_000, maxScrollPct: 5 }), // slow reader of a short post
    ]);
    expect(s.bounceRate).toBeCloseTo(0.25, 10);
  });

  it('reports rates of 1 when every row qualifies', () => {
    const s = summariseViews([
      row({ completed: true, dwellMs: 100, maxScrollPct: 1 }),
      row({ completed: true, dwellMs: 200, maxScrollPct: 2 }),
    ]);
    expect(s.completionRate).toBe(1);
    expect(s.bounceRate).toBe(1);
  });
});

describe('summariseViews — device grouping', () => {
  it('buckets a null or blank device class as unknown rather than "null"', () => {
    const s = summariseViews([
      row({ deviceClass: null, dwellMs: 1000 }),
      row({ deviceClass: '   ', dwellMs: 3000 }),
      row({ deviceClass: '', dwellMs: 500_000 }),
      row({ deviceClass: 'mobile', dwellMs: 5000 }),
    ]);
    const classes = s.byDevice.map((d) => d.deviceClass);
    expect(classes).toContain(UNKNOWN_DEVICE);
    expect(classes).not.toContain('null');
    expect(classes).not.toContain('undefined');
    expect(classes).not.toContain('');
    const unknown = s.byDevice.find((d) => d.deviceClass === UNKNOWN_DEVICE);
    // Median 3000, mean 168_000 — the group is aggregated the same way as the
    // headline, not silently averaged.
    expect(unknown).toEqual({ deviceClass: UNKNOWN_DEVICE, reads: 3, medianDwellMs: 3000 });
  });

  it('medians dwell within each device, not across all of them', () => {
    const s = summariseViews([
      row({ deviceClass: 'mobile', dwellMs: 1000 }),
      row({ deviceClass: 'mobile', dwellMs: 3000 }),
      row({ deviceClass: 'mobile', dwellMs: 200_000 }),
      row({ deviceClass: 'desktop', dwellMs: 500_000 }),
    ]);
    expect(s.byDevice).toEqual([
      // Mean of the mobile group is 68_000; the median ignores its one
      // abandoned tab exactly as the headline does.
      { deviceClass: 'mobile', reads: 3, medianDwellMs: 3000 },
      { deviceClass: 'desktop', reads: 1, medianDwellMs: 500_000 },
    ]);
  });

  it('orders by reads descending and breaks ties on name ascending', () => {
    const s = summariseViews([
      ...Array.from({ length: 3 }, () => row({ deviceClass: 'mobile' })),
      ...Array.from({ length: 3 }, () => row({ deviceClass: 'desktop' })),
      row({ deviceClass: 'tablet' }),
    ]);
    expect(s.byDevice.map((d) => d.deviceClass)).toEqual(['desktop', 'mobile', 'tablet']);
  });
});

describe('summariseViews — referrers', () => {
  it('excludes direct traffic entirely instead of inventing a host', () => {
    const s = summariseViews([
      row({ referrerHost: null }),
      row({ referrerHost: '' }),
      row({ referrerHost: '  ' }),
      row({ referrerHost: 'bbc.co.uk' }),
    ]);
    expect(s.topReferrers).toEqual([{ host: 'bbc.co.uk', reads: 1 }]);
    expect(s.reads).toBe(4);
  });

  it('never emits the string "null" as a host', () => {
    const s = summariseViews([row({ referrerHost: null }), row({ referrerHost: null })]);
    expect(s.topReferrers).toEqual([]);
  });

  it('orders by reads descending and breaks ties on host ascending', () => {
    const hosts = [
      'news.ycombinator.com',
      'news.ycombinator.com',
      'bbc.co.uk',
      'bbc.co.uk',
      'x.com',
    ];
    const s = summariseViews(hosts.map((referrerHost) => row({ referrerHost })));
    expect(s.topReferrers).toEqual([
      { host: 'bbc.co.uk', reads: 2 },
      { host: 'news.ycombinator.com', reads: 2 },
      { host: 'x.com', reads: 1 },
    ]);
  });

  it('honours referrerLimit', () => {
    const hosts = ['a.com', 'a.com', 'a.com', 'b.com', 'b.com', 'c.com'];
    const rows = hosts.map((referrerHost) => row({ referrerHost }));
    expect(summariseViews(rows, { referrerLimit: 2 }).topReferrers).toEqual([
      { host: 'a.com', reads: 3 },
      { host: 'b.com', reads: 2 },
    ]);
    expect(summariseViews(rows, { referrerLimit: 0 }).topReferrers).toEqual([]);
    // A negative limit clamps to nothing rather than reaching slice(0, -1),
    // which would drop the LAST row and keep the rest.
    expect(summariseViews(rows, { referrerLimit: -1 }).topReferrers).toEqual([]);
  });

  it('falls back to the default limit rather than emptying the table on a nonsense limit', () => {
    const rows = ['a.com', 'b.com', 'c.com'].map((referrerHost) => row({ referrerHost }));
    expect(summariseViews(rows, { referrerLimit: Number.NaN }).topReferrers).toHaveLength(3);
  });

  it('defaults to ten referrers', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ referrerHost: `host-${i}.com` }));
    expect(summariseViews(rows).topReferrers).toHaveLength(10);
  });
});

describe('summariseViews — daily buckets are UTC', () => {
  it('buckets by UTC day, not by the Europe/London day Umami uses', () => {
    // 23:30 UTC on 30 March is 00:30 on 31 March in BST. Umami's
    // getDailyViews hard-codes timezone=Europe/London and would file this
    // read under the 31st; this series must file it under the 30th.
    const s = summariseViews([row({ createdAt: new Date('2026-03-30T23:30:00Z') })]);
    expect(s.daily).toEqual([{ day: '2026-03-30', reads: 1, medianDwellMs: 60_000 }]);
  });

  it('groups per day, medians within the day, and sorts ascending', () => {
    const s = summariseViews([
      row({ createdAt: new Date('2026-08-03T09:00:00Z'), dwellMs: 8000 }),
      row({ createdAt: new Date('2026-08-01T23:59:59Z'), dwellMs: 1000 }),
      row({ createdAt: new Date('2026-08-01T00:00:00Z'), dwellMs: 3000 }),
      row({ createdAt: new Date('2026-08-01T12:00:00Z'), dwellMs: 900_000 }),
    ]);
    expect(s.daily).toEqual([
      { day: '2026-08-01', reads: 3, medianDwellMs: 3000 },
      { day: '2026-08-03', reads: 1, medianDwellMs: 8000 },
    ]);
  });

  it('sorts across a year boundary chronologically', () => {
    const s = summariseViews([
      row({ createdAt: new Date('2027-01-02T00:00:00Z') }),
      row({ createdAt: new Date('2026-12-31T00:00:00Z') }),
      row({ createdAt: new Date('2027-01-10T00:00:00Z') }),
    ]);
    expect(s.daily.map((d) => d.day)).toEqual(['2026-12-31', '2027-01-02', '2027-01-10']);
  });

  it('drops an unusable date from daily without throwing or losing the read', () => {
    const s = summariseViews([
      row({ createdAt: new Date('nonsense') }),
      row({ createdAt: new Date('2026-08-01T12:00:00Z') }),
    ]);
    expect(s.reads).toBe(2);
    expect(s.daily).toEqual([{ day: '2026-08-01', reads: 1, medianDwellMs: 60_000 }]);
  });
});

describe('formatDwell', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [1000, '1s'],
    [45_000, '45s'],
    [59_999, '59s'],
    [60_000, '1m 0s'],
    [130_000, '2m 10s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 0m'],
    [3_780_000, '1h 3m'],
    [90_061_000, '25h 1m'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDwell(ms)).toBe(expected);
  });

  it('refuses to render nonsense as a duration', () => {
    expect(formatDwell(-5000)).toBe('0s');
    expect(formatDwell(Number.NaN)).toBe('0s');
    expect(formatDwell(Number.POSITIVE_INFINITY)).toBe('0s');
  });

  it('formats a median straight out of summariseViews', () => {
    const s = summariseViews([1000, 2000, 3000, 10_000].map((dwellMs) => row({ dwellMs })));
    expect(formatDwell(s.medianDwellMs)).toBe('2s');
    expect(formatDwell(s.meanDwellMs)).toBe('4s');
  });
});
