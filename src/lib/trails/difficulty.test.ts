import { describe, expect, it } from 'vitest';
import { gradeDifficulty } from './difficulty';

describe('gradeDifficulty', () => {
  it('grades a short flat walk easy', () => {
    const d = gradeDifficulty({ distanceM: 4000, ascentM: 5, sport: 'walk' });
    expect(d.band).toBe('easy');
    expect(d.equivalentKm).toBe(4);
    expect(d.climbUnknown).toBe(false);
    expect(d.reasons[0]).toContain('essentially flat');
  });

  it('counts climb at 1 km per 100 m — a hilly 10k run grades hard', () => {
    // 10 km + 450 m of climb → 14.5 eq-km, over the run moderate bound of 14.
    const d = gradeDifficulty({ distanceM: 10_000, ascentM: 450, sport: 'run' });
    expect(d.equivalentKm).toBe(14.5);
    expect(d.band).toBe('hard');
    expect(d.reasons[0]).toContain('equivalent-km');
  });

  it('bands per sport — the same outing is severe on foot, easy on a road bike', () => {
    const input = { distanceM: 30_000, ascentM: 300 } as const;
    expect(gradeDifficulty({ ...input, sport: 'walk' }).band).toBe('severe');
    expect(gradeDifficulty({ ...input, sport: 'ride' }).band).toBe('easy');
  });

  it('grades on distance alone when ascent is unknown, and says so', () => {
    const d = gradeDifficulty({ distanceM: 12_000, ascentM: null, sport: 'run' });
    expect(d.climbUnknown).toBe(true);
    expect(d.equivalentKm).toBe(12);
    expect(d.band).toBe('moderate');
    expect(d.reasons[0]).toContain('graded on distance alone');
  });

  it('nudges the grade up when a share of the route is steps', () => {
    const flat = gradeDifficulty({ distanceM: 7800, ascentM: 0, sport: 'run' });
    const steppy = gradeDifficulty({ distanceM: 7800, ascentM: 0, sport: 'run', stepsShare: 0.08 });
    expect(flat.band).toBe('easy');
    expect(steppy.equivalentKm).toBeGreaterThan(flat.equivalentKm);
    expect(steppy.band).toBe('moderate');
    expect(steppy.reasons.some((r) => r.includes('steps'))).toBe(true);
  });

  it('falls back to run bands for an unknown sport', () => {
    const d = gradeDifficulty({ distanceM: 16_000, ascentM: 0, sport: 'unicycle' });
    expect(d.band).toBe('hard');
  });

  it('estimates a Naismith moving time', () => {
    // 10 km hike at 4.5 km/h + 300 m at 6 s/m = 8000 s + 1800 s.
    const d = gradeDifficulty({ distanceM: 10_000, ascentM: 300, sport: 'hike' });
    expect(d.estimatedTimeS).toBe(9800);
  });
});
