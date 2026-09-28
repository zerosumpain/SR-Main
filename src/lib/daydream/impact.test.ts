import { describe, expect, it } from 'vitest';
import { computeImpact, counts, weekBars, weekStart, windowStats, type ImpactRow } from './impact';

const NOW = new Date('2026-09-28T20:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(p: Partial<ImpactRow> = {}): ImpactRow {
  return {
    kind: 'think_correlate',
    status: 'delivered',
    suppressedReason: null,
    feedback: null,
    feedbackAt: null,
    createdAt: daysAgo(1),
    deliveredAt: daysAgo(1),
    evidence: [{ kind: 'think-question', id: 'health' }],
    ...p,
  };
}

describe('counts', () => {
  it('counts think notes the feed shows, not ones the audit dropped', () => {
    expect(counts(row())).toBe(true);
    expect(counts(row({ status: 'suppressed', suppressedReason: 'feed_only: daily cap' }))).toBe(true);
    expect(counts(row({ status: 'suppressed', suppressedReason: 'refuted' }))).toBe(false);
  });
  it('counts a legacy note only when it reached him', () => {
    expect(counts(row({ kind: 'pattern_break', deliveredAt: null }))).toBe(false);
    expect(counts(row({ kind: 'pattern_break', deliveredAt: null, feedback: 'useful' }))).toBe(true);
  });
});

describe('windowStats', () => {
  it('keeps unrated out of the hit rate and reports the decided share', () => {
    const rows = [
      row({ feedback: 'useful', feedbackAt: daysAgo(0.5) }),
      row({ feedback: 'not_useful', feedbackAt: daysAgo(0.9) }),
      row(),
      row(),
    ];
    const s = windowStats(rows, daysAgo(28), NOW);
    expect(s).toMatchObject({ noticed: 4, rated: 2, useful: 1, hitRate: 0.5, decidedShare: 0.5 });
    expect(s.medianHoursToDecide).toBeCloseTo(7.2, 1);
  });
  it('is null, not zero, with nothing to measure', () => {
    expect(windowStats([], daysAgo(28), NOW)).toMatchObject({ hitRate: null, decidedShare: null, medianHoursToDecide: null });
  });
});

describe('weekBars', () => {
  it('starts weeks on Monday UTC', () => {
    expect(weekStart(NOW).toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(weekStart(new Date('2026-09-27T23:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-21');
  });
  it('labels which engine wrote a week', () => {
    const bars = weekBars(
      [row({ createdAt: daysAgo(0) }), row({ kind: 'pattern_break', createdAt: daysAgo(3) }), row({ createdAt: daysAgo(4) })],
      NOW,
      3,
    );
    expect(bars.map((b) => [b.start, b.engine, b.noticed])).toEqual([
      ['2026-09-14', 'none', 0],
      ['2026-09-21', 'mixed', 2],
      ['2026-09-28', 'loop', 1],
    ]);
  });
});

describe('computeImpact', () => {
  it('builds the funnel from notes, checks and builds in the window', () => {
    const i = computeImpact(
      [row({ feedback: 'useful', feedbackAt: NOW }), row({ feedback: 'not_useful', feedbackAt: NOW }), row()],
      [
        { state: 'completed', approvedAt: daysAgo(2), createdAt: daysAgo(3), updatedAt: daysAgo(1) },
        { state: 'awaiting_approval', approvedAt: null, createdAt: daysAgo(1), updatedAt: daysAgo(1) },
      ],
      [{ status: 'shipped', accepted: true, acceptedAt: daysAgo(30), createdAt: daysAgo(40), updatedAt: daysAgo(2) }],
      NOW,
    );
    expect(i.funnel).toEqual({ spotted: 3, decided: 2, useful: 1, actedOn: 1, result: 2 });
    expect(i.checks).toEqual({ awaiting: 1, running: 0, completed: 1 });
    expect(i.byArea).toEqual([{ key: 'health', label: 'Health', noticed: 3, rated: 2, useful: 1 }]);
    expect(i.byKind[0]).toMatchObject({ key: 'correlate', label: 'A connection' });
  });
});
