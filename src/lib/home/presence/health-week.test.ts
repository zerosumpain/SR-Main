import { describe, expect, it } from 'vitest';
import { weekHealth, type HealthDay } from './health-week';

const day = (date: string, over: Partial<HealthDay['timeline']> = {}): HealthDay => {
  const from = Date.parse(`${date}T00:00:00Z`) / 1000 - 3600;
  return { date, from, to: from + 86_400, timeline: { heartRate: { seconds: 300, bins: [] }, restingHeartRate: null, steps: [], workouts: [], sleep: [], ...over } };
};

describe('a week of health', () => {
  it('takes each day’s step count, never a sum of records', () => {
    const w = weekHealth([
      day('2026-10-20', { steps: [{ value: 4000, start: '2026-10-20T08:00:00Z', end: '2026-10-20T09:00:00Z' }, { value: 9000, start: '2026-10-20T08:00:00Z', end: '2026-10-20T21:00:00Z' }] }),
      day('2026-10-21', { steps: [{ value: 5000, start: '2026-10-21T08:00:00Z', end: '2026-10-21T20:00:00Z' }] }),
      day('2026-10-22'),
    ]);
    expect(w).toMatchObject({ days: 3, steps: 7000, stepDays: 2 });
  });

  it('counts a night once, overlaps once, and leaves out awake and in-bed time', () => {
    const night = [
      { stage: 'inBed', start: '2026-10-20T21:30:00Z', end: '2026-10-21T06:30:00Z' },
      { stage: 'core', start: '2026-10-20T22:00:00Z', end: '2026-10-21T02:00:00Z' },
      { stage: 'deep', start: '2026-10-21T01:00:00Z', end: '2026-10-21T03:00:00Z' },
      { stage: 'awake', start: '2026-10-21T03:00:00Z', end: '2026-10-21T03:30:00Z' },
      { stage: 'rem', start: '2026-10-21T03:30:00Z', end: '2026-10-21T06:00:00Z' },
    ];
    // Both days' reads overlap the night: it is one night of 7.5 h.
    const w = weekHealth([day('2026-10-20', { sleep: night }), day('2026-10-21', { sleep: night })]);
    expect(w).toMatchObject({ sleepHours: 7.5, nights: 1 });
  });

  it('counts workouts once and says nothing it was not given', () => {
    const run = { activity: 'Running', start: '2026-10-20T17:00:00Z', end: '2026-10-20T17:40:00Z', seconds: 2400, distance: 6000 };
    expect(weekHealth([day('2026-10-20', { workouts: [run] }), day('2026-10-21', { workouts: [run] })])).toMatchObject({ workouts: 1, workoutMinutes: 40 });
    expect(weekHealth([day('2026-10-20')])).toMatchObject({ steps: null, sleepHours: null, workouts: 0 });
  });
});
