import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./series', async (orig) => {
  const real = await orig<typeof import('./series')>();
  return { ...real, loadSeries: vi.fn() };
});

import { loadSeries } from './series';
import { MIN_PAIRS } from './stats';
import { correlateRows, createCorrelator, refusal } from './correlate';

/** `n` days where b tracks a closely, with a little noise. */
function rows(n: number, relate = true): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => {
    const steps = 6000 + ((i * 7919) % 5000);
    return {
      day: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
      steps,
      sleepMinutes: relate ? 300 + steps / 50 + ((i * 31) % 7) : 400 + ((i * 131) % 97),
    };
  });
}

beforeEach(() => vi.clearAllMocks());

describe('refusal', () => {
  it('names the vocabulary when a metric is unknown', () => {
    const r = refusal('Readiness', 'steps');
    expect(r).toMatch(/"Readiness" is not a day-feature metric/);
    expect(r).toMatch(/sleepMinutes/);
  });

  it('refuses a pair related by definition', () => {
    expect(refusal('recoveryScore', 'hrvMs')).toMatch(/by definition/);
  });

  it('refuses a metric against itself', () => {
    expect(refusal('steps', 'steps')).toMatch(/itself/);
  });

  it('lets a genuine cross-domain question through', () => {
    expect(refusal('steps', 'sleepMinutes')).toBeNull();
  });
});

describe('correlateRows', () => {
  it('reports r, n and p for both lags', () => {
    const out = correlateRows(rows(60), 'steps', 'sleepMinutes', 60);
    expect(out.ok).toBe(true);
    expect(out.tests).toHaveLength(2);
    expect(out.tests[0].result.n).toBe(60);
    expect(out.tests[0].result.r).toBeGreaterThan(0.8);
    expect(out.text).toMatch(/same day: r -?\d\.\d\d over 60 paired days, p /);
    expect(out.text).toMatch(/not a cause/);
  });

  it('will not report a coefficient below the minimum pairs', () => {
    const out = correlateRows(rows(MIN_PAIRS - 1), 'steps', 'sleepMinutes', 30);
    expect(out.ok).toBe(false);
    expect(out.tests).toEqual([]);
    expect(out.text).toMatch(/below the \d+ needed/);
  });

  it('drops days either side is missing rather than imputing them', () => {
    const r = rows(40).map((row, i) => (i % 2 ? { ...row, sleepMinutes: null } : row));
    const out = correlateRows(r, 'steps', 'sleepMinutes', 40);
    expect(out.tests[0].result.n).toBe(20);
  });
});

describe('createCorrelator', () => {
  it('does not query for a refused pair', async () => {
    const tool = createCorrelator();
    const out = await tool({ a: 'recoveryScore', b: 'hrvMs' });
    expect(out.ok).toBe(false);
    expect(loadSeries).not.toHaveBeenCalled();
  });

  it('corrects across every test the cycle has run', async () => {
    vi.mocked(loadSeries).mockResolvedValue(rows(60));
    const tool = createCorrelator();
    const first = await tool({ a: 'steps', b: 'sleepMinutes', days: 60 });
    expect(first.text).toMatch(/across the 2 test\(s\)/);
    vi.mocked(loadSeries).mockResolvedValue(rows(60, false));
    const second = await tool({ a: 'steps', b: 'sleepMinutes', days: 60 });
    expect(second.text).toMatch(/across the 4 test\(s\)/);
    expect(second.text).toMatch(/same day q /);
  });

  it('clamps the window', async () => {
    vi.mocked(loadSeries).mockResolvedValue(rows(30));
    await createCorrelator()({ a: 'steps', b: 'sleepMinutes', days: 5 });
    expect(vi.mocked(loadSeries).mock.calls[0][0]?.windowDays).toBe(21);
  });
});
