import { describe, it, expect } from 'vitest';
import {
  watchExpiry,
  UNBOUND_MAX_AGE_MS,
  BOUND_MAX_AGE_MS,
  TARGETED_MAX_RUNS,
  PULSE_RETENTION_DAYS,
} from '$lib/heartbeat/audit';

/**
 * The three watches that ran away, as they actually were on 2026-08-24 when a
 * human stopped them by hand:
 *
 *   heartbeat-proof-20260809                  43,115 runs, registered 08-09
 *   watch-pr-247-ci-and-merge                 17,082 runs, registered 08-12
 *   watch-apple-calendar-provenance-eb57c2fb   3,584 runs, registered 08-12
 *
 * All three had `config = {}` and every single pulse was an `ok`, so the
 * failure budget never applied — there were no failures. A watch that is
 * succeeding had no budget of any kind.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-08-24T19:00:00Z');
const ago = (ms: number) => new Date(NOW - ms);

describe('a watch that cannot retire itself gets a ceiling', () => {
  it('retires an unbound watch after a day', () => {
    const r = watchExpiry({ kind: 'targeted', createdAt: ago(25 * HOUR), totalRuns: 100, config: {}, now: NOW });
    expect(r.expired).toBe(true);
    expect(r.expired && r.reason).toMatch(/no task binding/);
  });

  it('leaves an unbound watch alone inside the day', () => {
    expect(
      watchExpiry({ kind: 'targeted', createdAt: ago(23 * HOUR), totalRuns: 100, config: {}, now: NOW }).expired,
    ).toBe(false);
  });

  it('would have caught all three of the real runaways', () => {
    const real = [
      { name: 'heartbeat-proof-20260809', createdAt: ago(15 * DAY), totalRuns: 43_115 },
      { name: 'watch-pr-247-ci-and-merge', createdAt: ago(12 * DAY), totalRuns: 17_082 },
      { name: 'watch-apple-calendar-provenance-eb57c2fb', createdAt: ago(12 * DAY), totalRuns: 3_584 },
    ];
    for (const w of real) {
      const r = watchExpiry({ kind: 'targeted', createdAt: w.createdAt, totalRuns: w.totalRuns, config: {}, now: NOW });
      expect(r.expired, `${w.name} should have been retired`).toBe(true);
    }
  });

  it('gives a bound watch longer, because it CAN retire itself', () => {
    const cfg = { taskKind: 'build', taskId: 'abc' };
    // Two days: past the unbound ceiling, inside the bound one.
    expect(watchExpiry({ kind: 'targeted', createdAt: ago(2 * DAY), totalRuns: 10, config: cfg, now: NOW }).expired).toBe(false);
    const r = watchExpiry({ kind: 'targeted', createdAt: ago(8 * DAY), totalRuns: 10, config: cfg, now: NOW });
    expect(r.expired).toBe(true);
    expect(r.expired && r.reason).toMatch(/never reported a terminal state/);
  });

  it('caps on runs as well as age, whichever comes first', () => {
    // A one-second cadence would hit the run cap long before a day is up.
    const r = watchExpiry({ kind: 'targeted', createdAt: ago(HOUR), totalRuns: TARGETED_MAX_RUNS, config: {}, now: NOW });
    expect(r.expired).toBe(true);
    expect(r.expired && r.reason).toMatch(/run cap/);
  });

  it('counts the tick being recorded — the counter is written after this call', () => {
    const justUnder = watchExpiry({ kind: 'targeted', createdAt: ago(HOUR), totalRuns: TARGETED_MAX_RUNS - 2, config: {}, now: NOW });
    const atCap = watchExpiry({ kind: 'targeted', createdAt: ago(HOUR), totalRuns: TARGETED_MAX_RUNS - 1, config: {}, now: NOW });
    expect(justUnder.expired).toBe(false);
    expect(atCap.expired).toBe(true);
  });

  it('never touches a system-scan action', () => {
    // Infrastructure. chat-continuation has run 150,505 times doing its job.
    const r = watchExpiry({ kind: 'system-scan', createdAt: ago(120 * DAY), totalRuns: 150_505, config: {}, now: NOW });
    expect(r.expired).toBe(false);
  });

  it('treats a half-filled config as unbound', () => {
    // Only both halves make a state provider reachable.
    for (const cfg of [{ taskKind: 'build' }, { taskId: 'abc' }, {}, null]) {
      const r = watchExpiry({ kind: 'targeted', createdAt: ago(25 * HOUR), totalRuns: 1, config: cfg, now: NOW });
      expect(r.expired, `config ${JSON.stringify(cfg)} should count as unbound`).toBe(true);
    }
  });

  it('says why, because "done" alone cannot distinguish finished from stopped', () => {
    const r = watchExpiry({ kind: 'targeted', createdAt: ago(30 * HOUR), totalRuns: 1, config: {}, now: NOW });
    expect(r.expired && r.reason).toContain('30h');
  });
});

describe('pulse retention', () => {
  it('keeps a fortnight — enough to answer what a watch just did', () => {
    // 308,639 rows / 111MB by 2026-08-25, going back to 2026-05-06, with no
    // retention at all. Nothing reads a six-week-old pulse.
    expect(PULSE_RETENTION_DAYS).toBe(14);
  });

  it('gives an unbound watch a shorter leash than a bound one', () => {
    expect(UNBOUND_MAX_AGE_MS).toBeLessThan(BOUND_MAX_AGE_MS);
  });
});
