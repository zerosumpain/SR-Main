import { describe, expect, it } from 'vitest';
import { addDays, dueForReport, newTracker, progress, progressLine, resultText } from './track';

const plan = { kind: 'track' as const, metric: 'sleep_hours' as const, goal: 'at_least' as const, target: 7.5, days: 7, label: 'Sleep 7.5 hours a night' };
const t = newTracker(plan, { id: 'n1', title: 'Sleep is short' }, '2026-10-01', 't1', new Date('2026-10-01T08:00:00Z'));

describe('trackers', () => {
  it('runs for its days, inclusive', () => {
    expect(t.endDay).toBe('2026-10-07');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('counts hits on recorded days only, against the weeks before', () => {
    const days = [
      { day: '2026-09-20', value: 6.5 },
      { day: '2026-09-25', value: 6.9 },
      { day: '2026-10-01', value: 7.8 },
      { day: '2026-10-02', value: 7.0 },
      { day: '2026-10-04', value: 8.1 },
    ];
    const p = progress(t, days, '2026-10-04');
    expect(p).toMatchObject({ status: 'running', recorded: 3, hits: 2, daysIn: 4, daysLeft: 4 });
    expect(p.baseline).toBeCloseTo(6.7);
    expect(progressLine(t, p)).toMatch(/2 of 3 recorded days on target \(at least 7\.5 h\); averaging 7\.63 h against 6\.7 h/);
  });

  it('reports once when it ends, with a verdict', () => {
    const days = ['01', '02', '03', '04', '05', '06', '07'].map((d) => ({ day: `2026-10-${d}`, value: 7.9 }));
    const p = progress(t, days, '2026-10-09');
    expect(p.status).toBe('finished');
    expect(resultText(t, p)).toMatch(/It held\./);
    expect(dueForReport([t], '2026-10-07')).toHaveLength(0);
    expect(dueForReport([t], '2026-10-08')).toHaveLength(1);
    expect(dueForReport([{ ...t, reportedAt: 'x' }], '2026-10-08')).toHaveLength(0);
    expect(dueForReport([{ ...t, stoppedAt: 'x' }], '2026-10-08')).toHaveLength(0);
  });

  it('says so when there are no readings, never counting them as misses', () => {
    const p = progress(t, [], '2026-10-03');
    expect(progressLine(t, p)).toMatch(/No sleep readings since it started/);
    expect(p.rate).toBeNull();
  });
});
