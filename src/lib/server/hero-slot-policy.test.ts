import { describe, it, expect } from 'vitest';
import { activitySlot, heroDayBounds, heroActivitySchema } from './hero-slot-policy';
import { HERO_ACTIVITY_DEFAULTS, HERO_SLOTS, isHeroSlot } from '$lib/constants/hero-slots';

describe('hero activity slots', () => {
  it.each([
    [0, 'inactive'], [2999, 'inactive'], [3000, 'average'], [9999, 'average'], [10000, 'very-active'],
  ])('selects both day types at %i steps', (steps, level) => {
    expect(activitySlot(steps, HERO_ACTIVITY_DEFAULTS, new Date('2026-09-07T12:00:00Z'))).toBe(`weekday-${level}`);
    expect(activitySlot(steps, HERO_ACTIVITY_DEFAULTS, new Date('2026-09-06T12:00:00Z'))).toBe(`weekend-${level}`);
  });
  it.each([null, NaN, Infinity, -1])('uses Default for missing/invalid steps %s', steps => {
    expect(activitySlot(steps, HERO_ACTIVITY_DEFAULTS)).toBe('default');
  });
  it('uses London weekend boundaries, not the server timezone', () => {
    expect(activitySlot(0, HERO_ACTIVITY_DEFAULTS, new Date('2026-09-04T22:59:59Z'))).toBe('weekday-inactive');
    expect(activitySlot(0, HERO_ACTIVITY_DEFAULTS, new Date('2026-09-04T23:00:00Z'))).toBe('weekend-inactive');
    expect(activitySlot(0, HERO_ACTIVITY_DEFAULTS, new Date('2026-09-06T23:00:00Z'))).toBe('weekday-inactive');
  });
  it('uses saved thresholds', () => {
    expect(activitySlot(150, { averageSteps: 100, veryActiveSteps: 200 }, new Date('2026-09-07T12:00:00Z'))).toBe('weekday-average');
  });
  it('validates thresholds and slot IDs', () => {
    expect(HERO_SLOTS).toHaveLength(7);
    expect(isHeroSlot('weekend-average')).toBe(true);
    expect(isHeroSlot('weekday-default')).toBe(false);
    for (const input of [{averageSteps: 0, veryActiveSteps: 10}, {averageSteps: 10, veryActiveSteps: 10}, {averageSteps: 10, veryActiveSteps: 9}, {averageSteps: 1.5, veryActiveSteps: 10}]) {
      expect(heroActivitySchema.safeParse(input).success).toBe(false);
    }
  });
  it.each([
    ['2026-03-29T12:00:00Z', '2026-03-29T00:00:00Z', '2026-03-29T23:00:00Z'],
    ['2026-10-25T12:00:00Z', '2026-10-24T23:00:00Z', '2026-10-26T00:00:00Z'],
    ['2026-09-06T23:30:00Z', '2026-09-06T23:00:00Z', '2026-09-07T23:00:00Z'],
  ])('reads the correct calendar day at %s', (now, start, end) => {
    expect(heroDayBounds(new Date(now))).toEqual({ start: Date.parse(start) / 1000, end: Date.parse(end) / 1000 });
  });
});
