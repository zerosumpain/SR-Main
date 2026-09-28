import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/db', () => ({ db: {} }));
const { owedAlerts } = await import('./watch-alerts.server');
import type { AgendaItem } from './agenda';
import type { WatchItem } from './forecast';

const off = { overdue: false, 'running-long': false, quiet: false, 'leave-by': false };
const watch: WatchItem[] = [
  { key: 'overdue:x:2026-09-28', kind: 'overdue', subject: 'sam', severity: 'watch', title: "Sam hasn't left for School", detail: 'Usually…', at: '' },
  { key: 'quiet:sam:t', kind: 'quiet', subject: 'sam', severity: 'watch', title: 'No location from Sam', detail: '…', at: '' },
];
const now = new Date('2026-09-28T14:00:00Z');
const item = (leaveBy: string): AgendaItem => ({
  id: 'ev1', title: 'Dentist', start: '2026-09-28T14:30:00Z', end: null, location: 'Clinic', calendar: null, subjects: ['sam'], assignedBy: 'title',
  place: { id: null, label: 'Clinic', lat: 0, lon: 0 }, origin: null, leaveBy, issue: null,
  travel: { source: 'routed', median: 12, low: 11, high: 19, p80: 18, samples: 0, basis: null, mode: 'vehicle' },
});

describe('what the phone is told', () => {
  it('raises nothing while every kind is off', () => {
    expect(owedAlerts(off, watch, [item('2026-09-28T14:05:00Z')], new Map(), now)).toEqual([]);
  });
  it('raises only the kinds switched on, keyed per occurrence', () => {
    const out = owedAlerts({ ...off, overdue: true }, watch, [], new Map(), now);
    expect(out.map((a) => a.key)).toEqual(['overdue:x:2026-09-28']);
  });
  it('nudges ten minutes before a leave-by time, not an hour before and not long after', () => {
    const on = { ...off, 'leave-by': true };
    const names = new Map([['sam', 'Sam']]);
    expect(owedAlerts(on, [], [item('2026-09-28T14:08:00Z')], names, now)[0]).toMatchObject({ key: 'leave-by:ev1', title: 'Leave by 15:08 for Dentist' });
    expect(owedAlerts(on, [], [item('2026-09-28T15:00:00Z')], names, now)).toEqual([]);
    expect(owedAlerts(on, [], [item('2026-09-28T13:40:00Z')], names, now)).toEqual([]);
  });
});
