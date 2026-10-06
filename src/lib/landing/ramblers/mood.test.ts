import { describe, expect, it } from 'vitest';
import { dayFlags, NO_DAY } from './day';
import { moodFor, type MoodInput } from './mood';

const base: MoodInput = { sky: 'cloudy', temp: 14, pulse: 72, dayPhase: 'day', day: NO_DAY };

describe('moodFor', () => {
  it('brings the cloud and the umbrella out when it rains', () => {
    const m = moodFor({ ...base, sky: 'rain' });
    expect(m.cloud).toBe('rain');
    expect(m.umbrella).toBe(true);
    expect(m.odds.garden).toBeLessThan(1);
    expect(m.why).toContain('it is raining');
  });

  it('sends him gardening on a warm clear day', () => {
    const m = moodFor({ ...base, sky: 'clear', temp: 18 });
    expect(m.cloud).toBeNull();
    expect(m.odds.garden).toBeGreaterThan(2);
  });

  it('reads a high pulse with no exercise as stress, but not after a workout', () => {
    const resting = moodFor({ ...base, pulse: 108 });
    const trained = moodFor({ ...base, pulse: 108, day: { ...NO_DAY, exercised: true } });
    expect(resting.odds.stressed).toBeGreaterThan(3);
    expect(trained.odds.stressed ?? 1).toBe(1);
    expect(trained.odds.workout).toBeGreaterThan(2);
  });

  it('ignores the pulse when there is no fresh reading', () => {
    expect(moodFor({ ...base, pulse: null }).odds.stressed).toBeUndefined();
  });

  it('settles him in front of the TV at night', () => {
    const m = moodFor({ ...base, dayPhase: 'night' });
    expect(m.odds.tv).toBeGreaterThan(1.5);
    expect(m.odds.sleep).toBeGreaterThan(2);
  });
});

describe('dayFlags', () => {
  it('turns totals into coarse flags only', () => {
    const f = dayFlags({ steps: 12000, exerciseMin: 35, flights: 2, cyclingKm: 0, walkRunKm: 7, mindfulMin: 0, daylightMin: 90 });
    expect(f).toEqual({ steps: 'high', exercised: true, climbed: false, cycled: false, walkedFar: true, mindful: false, outdoors: true });
    expect(JSON.stringify(f)).not.toMatch(/12000|35|90/);
  });
});
