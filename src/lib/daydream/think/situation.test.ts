import { describe, expect, it } from 'vitest';
import { companions, renderSituation, type PersonNow, type SituationInputs } from './situation';

const p = (name: string, status: PersonNow['status'], place: string | null = null, distanceKm: number | null = null): PersonNow => ({ name, status, place, distanceKm, ageMins: 5 });

const base: SituationInputs = {
  localTime: 'Wednesday 28 October 2026 at 09:40',
  me: p('John', 'out', 'Piazza Navona', 1440),
  others: [p('Ann', 'out', 'Piazza Navona', 1440), p('Jemima', 'out', 'Piazza Navona', 1440), p('Leo', 'home'), p('Ruth', 'off')],
  trip: { title: 'Rome half-term', destination: 'Rome', startDate: '2026-10-26', endDate: '2026-10-30', today: true },
  body: 'Readiness 78 (good): train as planned.',
  sleepLastNight: 6.4,
  recoveryToday: 81,
  hrv: { today: 62, usual: 55 },
  mood: { latest: 0.4, latestDay: '2026-10-27', week: 0.3, before: -0.1 },
  diary: 'Diary today to +1d: 1 event(s).\n  2026-10-28 10:00 Vatican slot',
};

describe('situation', () => {
  it('counts as company only people at the same place, on fresh fixes', () => {
    expect(companions(base.me, base.others)).toEqual(['Ann', 'Jemima']);
    expect(companions(p('John', 'home'), base.others)).toEqual(['Leo']);
    expect(companions(p('John', 'unknown'), base.others)).toEqual([]);
    // Out at an unnamed place is not "with" anyone.
    expect(companions(p('John', 'out'), [p('Ann', 'out')])).toEqual([]);
  });

  it('says he is away on a trip, with whom, and never a coordinate', () => {
    const text = renderSituation(base);
    expect(text).toMatch(/ON A TRIP: "Rome half-term" in Rome/);
    expect(text).toMatch(/Home routines, home training plans and house chores do not apply/);
    expect(text).toMatch(/With him \(same place now\): Ann, Jemima\./);
    expect(text).toMatch(/far from home/);
    expect(text).toMatch(/Ruth not sharing location/);
    expect(text).toMatch(/HRV 62 ms against a usual 55 ms/);
    expect(text).toMatch(/Mood: last logged pleasant \(0\.4/);
    expect(text).toMatch(/Vatican slot/);
    expect(text).not.toMatch(/\d+\.\d{4,}/);
  });

  it('says unknown rather than leave a gap', () => {
    const text = renderSituation({ ...base, me: null, others: [], trip: null, body: null, sleepLastNight: null, recoveryToday: null, hrv: null, mood: null, diary: null });
    expect(text).toMatch(/Where he is: unknown/);
    expect(text).toMatch(/Mood: none logged/);
    expect(text).toMatch(/Diary: could not be read — unknown, not empty/);
  });
});
