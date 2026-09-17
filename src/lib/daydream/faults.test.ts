import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable stub rather than `{}`, so the lane reporter's WRITES can be
// observed. The rest of this file never touches the db.
const calls = vi.hoisted(() => ({ raised: [] as Array<Record<string, unknown>>, closed: [] as unknown[] }));
vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        calls.raised.push(v);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () => {
            calls.closed.push(v);
            return Promise.resolve([{ id: 1 }]);
          },
        }),
      }),
    }),
  },
}));

import { BUILDABLE_WANTS, FAULT_KINDS, noteLaneOutcome, unknownMetricsIn, wantsFor } from './faults';

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


describe('noteLaneOutcome', () => {
  beforeEach(() => {
    calls.raised.length = 0;
    calls.closed.length = 0;
  });

  it('raises lane_silent when a whole answer is rejected', () => {
    // The appetite lane's thirteen nights: it proposed three every time and
    // was allowed to keep none, and every pulse still read `ok`.
    return noteLaneOutcome({
      lane: 'daydream-appetite',
      proposed: 3,
      admitted: 0,
      dropped: ['x: cites nothing in the pack'],
    }).then(() => {
      expect(calls.raised).toHaveLength(1);
      expect(calls.raised[0]).toMatchObject({ kind: 'lane_silent', identifier: 'daydream-appetite' });
      expect(String(calls.raised[0].detail)).toContain('3 proposed, 0 admitted');
      expect(String(calls.raised[0].detail)).toContain('cites nothing');
    });
  });

  it('says nothing when the lane proposed nothing — content is not silent', async () => {
    await noteLaneOutcome({ lane: 'daydream-ponder', proposed: 0, admitted: 0 });
    expect(calls.raised).toHaveLength(0);
    expect(calls.closed).toHaveLength(0);
  });

  it('says nothing when some of the answer survived', async () => {
    await noteLaneOutcome({ lane: 'daydream-ponder', proposed: 3, admitted: 1 });
    expect(calls.raised).toHaveLength(0);
  });

  it('clears the fault the moment the lane admits again', async () => {
    await noteLaneOutcome({ lane: 'daydream-appetite', proposed: 3, admitted: 3 });
    expect(calls.raised).toHaveLength(0);
    expect(calls.closed).toHaveLength(1);
  });

  it('records no reasons rather than pretending to have them', async () => {
    await noteLaneOutcome({ lane: 'daydream-spend', proposed: 2, admitted: 0 });
    expect(String(calls.raised[0].detail)).toContain('No reasons recorded');
  });

  it('ignores a nameless lane', async () => {
    await noteLaneOutcome({ lane: '   ', proposed: 3, admitted: 0 });
    expect(calls.raised).toHaveLength(0);
  });

  it('asks for a code change, since a gate rejecting everything lives in the repo', () => {
    expect(wantsFor('lane_silent')).toBe('code_change');
    expect(BUILDABLE_WANTS).toContain('code_change');
  });
});
