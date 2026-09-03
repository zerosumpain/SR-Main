import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

import { BUILDABLE_WANTS, FAULT_KINDS, unknownMetricsIn, wantsFor } from './faults';

describe('wantsFor', () => {
  it('gives every kind a shape, and only the buildable ones reach self-improve', () => {
    for (const k of FAULT_KINDS) expect(wantsFor(k)).toBeTruthy();
    expect(wantsFor('metric_unknown')).toBe('numeric_tool');
    expect(wantsFor('needs_source')).toBe('reader_tool');
    expect(wantsFor('silent_source')).toBe('connector');
    expect(wantsFor('tool_barren')).toBe('decline');
    expect(wantsFor('lead_barren')).toBe('more_days');
    expect(BUILDABLE_WANTS).not.toContain('more_days');
  });
});

describe('unknownMetricsIn', () => {
  it('reads the proposer and the ponder audit rejection strings', () => {
    expect(unknownMetricsIn('unknown metric: sleep_percentage')).toEqual(['sleep_percentage']);
    expect(unknownMetricsIn('lead readiness-drivers: unknown metrics readiness,time_away_from_home — the vocabulary is a, b')).toEqual([
      'readiness',
      'time_away_from_home',
    ]);
    expect(unknownMetricsIn('a metric cannot predict itself')).toEqual([]);
    expect(unknownMetricsIn('unknown metric: (missing)')).toEqual([]);
  });
});
