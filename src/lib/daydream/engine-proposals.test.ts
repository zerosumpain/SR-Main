import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./ledger', () => ({ loadDetectorRows: vi.fn() }));
vi.mock('./detectors', () => ({ DETECTORS: [] }));

import { proposeFrom } from './engine-proposals';

const NOW = new Date('2026-09-03T08:00:00Z');
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('proposeFrom', () => {
  it('names a detector silent for thirty days, and not one that fired last week', () => {
    const out = proposeFrom({
      now: NOW,
      detectorKinds: ['free_window', 'near_offer'],
      detectorLastFired: new Map([
        ['free_window', days(6)],
        ['near_offer', days(45)],
      ]),
      kindVotes: [],
      abandonedMetricCounts: [],
      review: { uncertain: 0, total: 0 },
    });
    expect(out.map((p) => p.title)).toEqual(['Detector near_offer has been silent for 30 days']);
  });

  it('withholds a useful-rate proposal under five votes and raises it over', () => {
    const base = { now: NOW, detectorKinds: [], detectorLastFired: new Map(), abandonedMetricCounts: [], review: { uncertain: 0, total: 0 } };
    expect(proposeFrom({ ...base, kindVotes: [{ kind: 'musing_money', useful: 1, notUseful: 3 }] })).toHaveLength(0);
    const out = proposeFrom({ ...base, kindVotes: [{ kind: 'musing_money', useful: 1, notUseful: 5 }] });
    expect(out[0].title).toMatch(/musing_money is rated useful only 17%/);
    expect(out[0].kind).toBe('engine');
  });

  it('raises a metric two abandoned leads share, and a reviewer that mostly cannot tell', () => {
    const base = { now: NOW, detectorKinds: [], detectorLastFired: new Map(), kindVotes: [] };
    const out = proposeFrom({
      ...base,
      abandonedMetricCounts: [
        { metric: 'sleepPerformance', leads: 2 },
        { metric: 'steps', leads: 1 },
      ],
      review: { uncertain: 5, total: 8 },
    });
    expect(out.map((p) => p.title)).toEqual([
      'Every lead about sleepPerformance has died barren',
      'The reviewer cannot tell 63% of the time',
    ]);
  });
});
