import { describe, expect, it } from 'vitest';
import { InterpretError, coerceCommission, parseCommissionJson } from './interpret';

describe('coerceCommission', () => {
  it('passes a well-formed commission through', () => {
    const c = coerceCommission({
      sport: 'trail_run',
      mode: 'loop',
      targetKm: 12,
      climbPerKm: 40,
      prefer: 'spiky',
      allowOutAndBack: false,
      startPlace: 'Darlington station',
      finishPlace: null,
    });
    expect(c).toEqual({
      sport: 'trail_run',
      mode: 'loop',
      targetKm: 12,
      climbPerKm: 40,
      prefer: 'spiky',
      allowOutAndBack: false,
      startPlace: 'Darlington station',
      finishPlace: null,
    });
  });

  it('coerces sport aliases instead of rejecting them', () => {
    expect(coerceCommission({ sport: 'jogging' }).sport).toBe('run');
    expect(coerceCommission({ sport: 'Trail Running' }).sport).toBe('trail_run');
    expect(coerceCommission({ sport: 'bike' }).sport).toBe('ride');
    expect(coerceCommission({ sport: 'swimming' }).sport).toBeNull();
  });

  it('clamps numbers into planner range and coerces numeric strings', () => {
    const c = coerceCommission({ targetKm: '250km', climbPerKm: 900 });
    expect(c.targetKm).toBe(100);
    expect(c.climbPerKm).toBe(200);
    expect(coerceCommission({ targetKm: -4 }).targetKm).toBeNull();
  });

  it('coerces stringly booleans', () => {
    expect(coerceCommission({ allowOutAndBack: 'yes' }).allowOutAndBack).toBe(true);
    expect(coerceCommission({ allowOutAndBack: 'nope' }).allowOutAndBack).toBeNull();
  });

  it('nulls everything on junk input', () => {
    const c = coerceCommission('not an object');
    expect(Object.values(c).every((v) => v === null)).toBe(true);
  });
});

describe('parseCommissionJson', () => {
  it('strips markdown fences before parsing', () => {
    const c = parseCommissionJson('```json\n{"sport": "run", "targetKm": 8}\n```');
    expect(c.sport).toBe('run');
    expect(c.targetKm).toBe(8);
  });

  it('throws InterpretError on non-JSON', () => {
    expect(() => parseCommissionJson('Sure! Here is a route plan for you.')).toThrow(
      InterpretError,
    );
  });
});
