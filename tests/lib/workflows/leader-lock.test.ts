import { describe, it, expect, vi, beforeEach } from 'vitest';

// #19 LEADER ELECTION — unit tests for the advisory-lock helper. The pure
// key-derivation function needs no DB; tryAdvisoryLock/releaseAdvisoryLock are
// tested with a mocked $lib/db (no live DB), asserting they decode pg's
// pg_try_advisory_lock result and degrade safely on error.

const captured = vi.hoisted(() => ({ nextResult: null as unknown, shouldThrow: false }));

vi.mock('$lib/db', () => ({
  db: {
    execute: vi.fn(async () => {
      if (captured.shouldThrow) throw new Error('db down');
      return captured.nextResult ?? { rows: [] };
    }),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: true, strings, vals }),
}));

import { advisoryLockKey, tryAdvisoryLock, releaseAdvisoryLock, SCHEDULER_LOCK_LANE } from '../../../src/lib/workflows/leader-lock';

beforeEach(() => {
  captured.nextResult = null;
  captured.shouldThrow = false;
});

describe('advisoryLockKey (pure)', () => {
  it('is deterministic for the same lane', () => {
    expect(advisoryLockKey('a')).toBe(advisoryLockKey('a'));
    expect(advisoryLockKey(SCHEDULER_LOCK_LANE)).toBe(advisoryLockKey(SCHEDULER_LOCK_LANE));
  });

  it('different lanes derive different keys', () => {
    expect(advisoryLockKey('lane-one')).not.toBe(advisoryLockKey('lane-two'));
  });

  it('produces a signed 32-bit integer', () => {
    const k = advisoryLockKey(SCHEDULER_LOCK_LANE);
    expect(Number.isInteger(k)).toBe(true);
    expect(k).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(k).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});

describe('tryAdvisoryLock', () => {
  it('returns true when pg reports the lock acquired', async () => {
    captured.nextResult = { rows: [{ locked: true }] };
    expect(await tryAdvisoryLock(SCHEDULER_LOCK_LANE)).toBe(true);
  });

  it('returns false when another session holds the lock', async () => {
    captured.nextResult = { rows: [{ locked: false }] };
    expect(await tryAdvisoryLock(SCHEDULER_LOCK_LANE)).toBe(false);
  });

  it('returns false (stays passive) on a DB error', async () => {
    captured.shouldThrow = true;
    expect(await tryAdvisoryLock(SCHEDULER_LOCK_LANE)).toBe(false);
  });
});

describe('releaseAdvisoryLock', () => {
  it('swallows DB errors', async () => {
    captured.shouldThrow = true;
    await expect(releaseAdvisoryLock(SCHEDULER_LOCK_LANE)).resolves.toBeUndefined();
  });
});
