import { describe, it, expect } from 'vitest';
import {
  chooseSignals,
  signalShape,
  PACK_SIGNAL_LIMIT,
  SIGNAL_MOVER_SEATS,
  SIGNAL_ROTATION_SEATS,
  type SignalRow,
} from './signals';

function row(key: string, over: Partial<SignalRow> = {}): SignalRow {
  return {
    key,
    label: key,
    unit: null,
    mean: 10,
    lo: 9,
    hi: 11,
    days: 7,
    priorMean: 10,
    priorSd: 1,
    priorDays: 21,
    lastDay: '2026-09-17',
    ...over,
  };
}

describe('chooseSignals', () => {
  it('returns everything when the registry is smaller than the pack', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(chooseSignals(rows, 0).map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });

  it('drops signals with too little history to quote', () => {
    const rows = [row('a', { days: 1 }), row('b', { mean: null })];
    expect(chooseSignals(rows, 0)).toEqual([]);
  });

  it('fills the movers seats by relative spread, widest first', () => {
    const rows = [
      row('flat', { lo: 10, hi: 10 }),
      row('wide', { lo: 0, hi: 40 }),
      row('mid', { lo: 8, hi: 12 }),
      ...Array.from({ length: 30 }, (_, i) => row(`z${i}`, { lo: 10, hi: 10 })),
    ];
    const picked = chooseSignals(rows, 0);
    expect(picked).toHaveLength(PACK_SIGNAL_LIMIT);
    expect(picked[0].key).toBe('wide');
    expect(picked[1].key).toBe('mid');
  });

  it('gives the rotation seats to signals the movers did not take', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(`s${String(i).padStart(2, '0')}`, { lo: 10 - i * 0.01, hi: 10 + i * 0.01 }),
    );
    const picked = chooseSignals(rows, 0);
    expect(picked).toHaveLength(PACK_SIGNAL_LIMIT);
    expect(new Set(picked.map((r) => r.key)).size).toBe(PACK_SIGNAL_LIMIT);
  });

  it('walks the whole registry as the cursor advances — the point of the rotation', () => {
    // 40 signals, 5 rotation seats a cycle. Eight cycles must reach every
    // signal that the movers never pick, or a sensor can sit unseen forever.
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(`s${String(i).padStart(2, '0')}`, { lo: 10 - i * 0.01, hi: 10 + i * 0.01 }),
    );
    const seen = new Set<string>();
    for (let cycle = 0; cycle < 12; cycle++) {
      for (const r of chooseSignals(rows, cycle * SIGNAL_ROTATION_SEATS)) seen.add(r.key);
    }
    expect(seen.size).toBe(40);
  });

  it('does not show the same rotation twice in consecutive cycles', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(`s${String(i).padStart(2, '0')}`, { lo: 10 - i * 0.01, hi: 10 + i * 0.01 }),
    );
    const a = chooseSignals(rows, 0).slice(SIGNAL_MOVER_SEATS).map((r) => r.key);
    const b = chooseSignals(rows, SIGNAL_ROTATION_SEATS).slice(SIGNAL_MOVER_SEATS).map((r) => r.key);
    expect(a).not.toEqual(b);
    expect(a.filter((k) => b.includes(k))).toEqual([]);
  });

  it('never exceeds the seat count', () => {
    const rows = Array.from({ length: 300 }, (_, i) => row(`s${i}`, { lo: 1, hi: 2 + i }));
    expect(chooseSignals(rows, 99)).toHaveLength(PACK_SIGNAL_LIMIT);
  });
});

describe('signalShape', () => {
  const today = '2026-09-17';

  it('says nothing when a signal is behaving normally', () => {
    expect(signalShape(row('a'), today)).toBe('');
  });

  it('reports a signal that has stopped reporting', () => {
    expect(signalShape(row('a', { lastDay: '2026-09-10' }), today)).toContain('No reading for 7 days');
  });

  it('does not call yesterday a gap', () => {
    expect(signalShape(row('a', { lastDay: '2026-09-16' }), today)).toBe('');
  });

  it('flags a brand-new signal', () => {
    expect(signalShape(row('a', { priorDays: 0, priorMean: null, priorSd: null }), today)).toContain(
      'First readings',
    );
  });

  it('reports a shift away from the signal’s own history', () => {
    const s = signalShape(row('a', { mean: 16, priorMean: 10, priorSd: 2, unit: '°C' }), today);
    expect(s).toContain('higher');
    expect(s).toContain('6 °C');
  });

  it('reports a shift downward too', () => {
    expect(signalShape(row('a', { mean: 4, priorMean: 10, priorSd: 2 }), today)).toContain('lower');
  });

  it('stays quiet when the move is inside the signal’s usual noise', () => {
    expect(signalShape(row('a', { mean: 11, priorMean: 10, priorSd: 2 }), today)).toBe('');
  });

  it('will not call a shift on too little prior history', () => {
    expect(signalShape(row('a', { mean: 30, priorMean: 10, priorSd: 1, priorDays: 3 }), today)).toBe('');
  });

  it('names a series that has not moved at all', () => {
    expect(signalShape(row('a', { lo: 21, hi: 21, mean: 21, priorSd: 0 }), today)).toContain('Unchanged');
  });

  it('says nothing about a signal with no recent readings', () => {
    expect(signalShape(row('a', { mean: null }), today)).toBe('');
  });
});
