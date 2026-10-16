import { describe, expect, it, vi } from 'vitest';
import {
  LEDGER_MAX,
  freshness,
  ledgerCardText,
  ledgerKey,
  parseLedger,
  recordTest,
  staleLine,
  summaryDue,
  summarySubject,
  type Ledger,
  type LedgerEntry,
} from './ledger';

const now = new Date('2026-10-16T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    a: 'sleepMinutes',
    b: 'recoveryScore',
    days: 90,
    n: 62,
    tests: [{ label: 'same day', r: -0.04, n: 62, p: 0.783 }],
    at: daysAgo(1),
    ...over,
  };
}

describe('freshness', () => {
  const ledger: Ledger = { [ledgerKey('sleepMinutes', 'recoveryScore')]: entry() };

  it('calls a never-tested pair fresh', () => {
    expect(freshness({}, 'sleepMinutes', 'recoveryScore', 90, 62, now)).toEqual({ fresh: true, prior: null });
  });

  it('calls the same pair a day later, with a day more data, stale — either way round', () => {
    // 15 and 16 October 2026: "extra sleep is not carrying into next-day recovery", four times.
    const f = freshness(ledger, 'recoveryScore', 'sleepMinutes', 90, 63, now);
    expect(f.fresh).toBe(false);
    if (!f.fresh) {
      expect(f.needN).toBe(81);
      expect(staleLine(f)).toMatch(/ALREADY TESTED[\s\S]*needs 81 paired days, or after 2026-11-14/);
    }
  });

  it('is fresh again with 30% more data, after a month, or over a very different window', () => {
    expect(freshness(ledger, 'sleepMinutes', 'recoveryScore', 90, 81, now).fresh).toBe(true);
    expect(freshness({ [ledgerKey('sleepMinutes', 'recoveryScore')]: entry({ at: daysAgo(31) }) }, 'sleepMinutes', 'recoveryScore', 90, 62, now).fresh).toBe(true);
    expect(freshness(ledger, 'sleepMinutes', 'recoveryScore', 180, 62, now).fresh).toBe(true);
  });
});

describe('the store shape', () => {
  it('parses defensively', () => {
    expect(parseLedger(null)).toEqual({});
    expect(parseLedger({ bad: { a: 1 }, good: entry() })).toEqual({ good: entry() });
  });

  it('keeps the newest pairs only', () => {
    let l: Ledger = {};
    for (let i = 0; i < LEDGER_MAX + 5; i++) l = recordTest(l, entry({ a: `m${i}`, at: new Date(now.getTime() + i * 1000).toISOString() }));
    expect(Object.keys(l)).toHaveLength(LEDGER_MAX);
    expect(Object.values(l).some((e) => e.a === 'm0')).toBe(false);
  });
});

describe('the monthly summary', () => {
  const six: Ledger = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, entry({ a: `m${i}` })]));

  it('is due over six pairs, once a month', () => {
    expect(summaryDue({ k: entry() }, null, now)).toBe(false);
    expect(summaryDue(six, null, now)).toBe(true);
    expect(summaryDue(six, daysAgo(10), now)).toBe(false);
    expect(summaryDue(six, daysAgo(31), now)).toBe(true);
  });

  it('has one subject per month and a card that lists every pair', () => {
    expect(summarySubject(now)).toBe('correlate:summary:2026-10');
    expect(ledgerCardText(six).split('\n')).toHaveLength(7);
  });
});

describe('the correlate tool with a ledger', () => {
  it('records a fresh test and flags a stale one', async () => {
    vi.resetModules();
    vi.doMock('../stats/series', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      const rows = Array.from({ length: 70 }, (_, i) => ({ sleepMinutes: 360 + (i % 5) * 24, recoveryScore: 40 + ((i * 7) % 30) }));
      return { ...real, loadSeries: vi.fn(async () => rows) };
    });
    const { createCorrelator } = await import('./correlate');
    const session = { ledger: {} as Ledger, recorded: [] as LedgerEntry[] };
    const fresh = await createCorrelator({ now, ledger: session })({ a: 'sleepMinutes', b: 'recoveryScore' });
    expect(fresh.ok).toBe(true);
    expect(fresh.stale).toBeUndefined();
    expect(session.recorded).toHaveLength(1);

    const later = { ledger: recordTest({}, session.recorded[0]), recorded: [] as LedgerEntry[] };
    const again = await createCorrelator({ now, ledger: later })({ a: 'recoveryScore', b: 'sleepMinutes' });
    expect(again.stale).toBe(true);
    expect(again.text).toMatch(/ALREADY TESTED/);
    expect(later.recorded).toHaveLength(0);
    vi.doUnmock('../stats/series');
  });
});
