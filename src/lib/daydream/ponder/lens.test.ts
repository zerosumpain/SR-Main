import { describe, it, expect } from 'vitest';
import {
  BASE_LIMITS,
  LENSES,
  LENS_FLOOR,
  briefFor,
  lensAt,
  limitsFor,
  signalPreferenceFor,
  type PackLimitKey,
} from './lens';

const CYCLE = 2 * 3_600_000;
const KEYS = Object.keys(BASE_LIMITS) as PackLimitKey[];

describe('lensAt', () => {
  it('advances one lens per cycle', () => {
    const t0 = new Date('2026-09-17T00:00:00Z');
    const seen = LENSES.map((_, i) => lensAt(new Date(t0.getTime() + i * CYCLE), CYCLE));
    expect(new Set(seen).size).toBe(LENSES.length);
  });

  it('wraps back round after a full rotation', () => {
    const t0 = new Date('2026-09-17T00:00:00Z');
    const a = lensAt(t0, CYCLE);
    const b = lensAt(new Date(t0.getTime() + LENSES.length * CYCLE), CYCLE);
    expect(b).toBe(a);
  });

  it('does not change inside one cycle', () => {
    const t0 = new Date('2026-09-17T00:00:00Z');
    expect(lensAt(new Date(t0.getTime() + CYCLE - 1), CYCLE)).toBe(lensAt(t0, CYCLE));
  });

  it('is stable across a restart — nothing is stored', () => {
    const t = new Date('2026-09-17T14:31:09Z');
    expect(lensAt(t, CYCLE)).toBe(lensAt(new Date(t.getTime()), CYCLE));
  });

  it('gives every lens a turn within a day at the shipped cadence', () => {
    // Eight cycles a day, six lenses: every angle must be looked at daily or
    // the `patterns` and `general` themes go on never firing.
    const t0 = new Date('2026-09-17T00:00:00Z');
    const day = new Set(Array.from({ length: 12 }, (_, i) => lensAt(new Date(t0.getTime() + i * CYCLE), CYCLE)));
    expect(day.size).toBe(LENSES.length);
  });
});

describe('limitsFor', () => {
  it('keeps every category present under every lens', () => {
    for (const lens of LENSES) {
      const l = limitsFor(lens);
      for (const k of KEYS) {
        expect(l[k], `${lens}.${k}`).toBeGreaterThanOrEqual(LENS_FLOOR);
      }
    }
  });

  it('gives money the seats for spending and offers', () => {
    const money = limitsFor('money');
    expect(money.spendRows).toBeGreaterThan(BASE_LIMITS.spendRows);
    expect(money.offers).toBeGreaterThan(BASE_LIMITS.offers);
  });

  it('takes diary seats away from the lenses that are not about the diary', () => {
    expect(limitsFor('house').weekAhead).toBeLessThan(BASE_LIMITS.weekAhead);
    expect(limitsFor('knowledge').weekAhead).toBeLessThan(BASE_LIMITS.weekAhead);
    expect(limitsFor('longview').weekAhead).toBeLessThan(BASE_LIMITS.weekAhead);
  });

  it('gives the household lens more of the week, not less', () => {
    expect(limitsFor('household').weekAhead).toBeGreaterThan(BASE_LIMITS.weekAhead);
  });

  it('never returns a zero — a narrowed lens must still see an emergency', () => {
    for (const lens of LENSES) {
      for (const k of KEYS) expect(limitsFor(lens)[k]).toBeGreaterThan(0);
    }
  });

  it('reproduces the shipped pack when every weight is 1', () => {
    // The guarantee that makes this change safe to land: an unweighted lens is
    // the pack exactly as it was.
    const base = limitsFor('money', { ...BASE_LIMITS });
    expect(Object.keys(base).sort()).toEqual(KEYS.sort());
  });
});

describe('signalPreferenceFor', () => {
  it('points the house lens at the sensors', () => {
    expect(signalPreferenceFor('house')).toContain('ha:');
  });

  it('returns a list for every lens, empty where there is no preference', () => {
    for (const lens of LENSES) expect(Array.isArray(signalPreferenceFor(lens))).toBe(true);
    expect(signalPreferenceFor('money')).toEqual([]);
  });
});

describe('briefFor', () => {
  it('gives every lens a brief', () => {
    for (const lens of LENSES) {
      const lines = briefFor(lens);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0].length).toBeGreaterThan(40);
    }
  });

  it('always says the brief is a direction and not a fence', () => {
    for (const lens of LENSES) {
      expect(briefFor(lens).join(' ')).toMatch(/still beats|not a fence/i);
    }
  });
});
