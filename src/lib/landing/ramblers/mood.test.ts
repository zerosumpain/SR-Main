import { describe, expect, it } from 'vitest';
import { NO_DAY } from './day';
import { moodFor, type MoodInput } from './mood';

const base: MoodInput = { sky: 'cloudy', temp: 14, pulse: 72, dayPhase: 'day', day: NO_DAY };

describe('moodFor', () => {
  it('brings the cloud and the umbrella out when it rains', () => {
    const m = moodFor({ ...base, sky: 'rain' });
    expect(m.cloud).toBe('rain');
    expect(m.umbrella).toBe(true);
    expect(m.why).toContain('it is raining');
  });

  it('puts the scarf on when it is cold', () => {
    expect(moodFor({ ...base, temp: 4 }).scarf).toBe(true);
    expect(moodFor(base).scarf).toBe(false);
  });

  it('passes the day through to the drives, with a clock hour from the phase when none is given', () => {
    const m = moodFor({ ...base, dayPhase: 'night', sleep: 'low' });
    expect(m.input.hour).toBe(23);
    expect(m.input.sleep).toBe('low');
    expect(moodFor({ ...base, hour: 9.5 }).input.hour).toBe(9.5);
  });
});
