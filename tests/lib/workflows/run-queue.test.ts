import { describe, it, expect, vi, beforeEach } from 'vitest';

// #19 DURABLE RUN-WORKER — unit tests for the pure-ish run-queue logic. We mock
// $lib/db so no live DB is needed (mirrors run-helpers.test.ts). The pure
// helpers (deriveWorkerId / computeLeaseExpiry / isLeaseExpired / isClaimable)
// need no DB at all; the DB-calling functions assert the SQL is issued and the
// row-count/return-shape decoding is correct.

const captured = vi.hoisted(() => ({ executed: [] as Array<{ sqlObj: unknown }>, nextResult: null as unknown }));

vi.mock('$lib/db', () => ({
  db: {
    execute: vi.fn(async (sqlObj: unknown) => {
      captured.executed.push({ sqlObj });
      return captured.nextResult ?? { rows: [], rowCount: 0 };
    }),
  },
}));

// drizzle-orm's sql tag — return a sentinel so we can confirm execute() got a
// truthy SQL object without depending on its internal structure.
vi.mock('drizzle-orm', () => {
  const tag = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: true, strings, vals });
  return { sql: tag };
});

import {
  deriveWorkerId,
  computeLeaseExpiry,
  isLeaseExpired,
  isClaimable,
  enqueue,
  claimNext,
  renewLease,
  clearLease,
  releaseExpiredLeases,
  DEFAULT_LEASE_MS,
} from '../../../src/lib/workflows/run-queue';

beforeEach(() => {
  captured.executed = [];
  captured.nextResult = null;
});

describe('run-queue pure helpers', () => {
  it('deriveWorkerId is stable and combines host/pid/rand', () => {
    expect(deriveWorkerId('homeserv', 1234, 'abcd')).toBe('homeserv:1234:abcd');
  });

  it('computeLeaseExpiry adds the lease duration to now', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(computeLeaseExpiry(now, 60_000).toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('computeLeaseExpiry floors negative durations at 0', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(computeLeaseExpiry(now, -5000).getTime()).toBe(now.getTime());
  });

  it('isLeaseExpired treats null/past as expired and future as live', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isLeaseExpired(null, now)).toBe(true);
    expect(isLeaseExpired(undefined, now)).toBe(true);
    expect(isLeaseExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isLeaseExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });

  describe('isClaimable mirrors the claim WHERE clause', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    it('non-pending rows are never claimable', () => {
      expect(isClaimable({ status: 'running', claimedBy: null, leaseExpiresAt: null }, now)).toBe(false);
      expect(isClaimable({ status: 'completed', claimedBy: null, leaseExpiresAt: null }, now)).toBe(false);
    });
    it('unclaimed pending rows are claimable', () => {
      expect(isClaimable({ status: 'pending', claimedBy: null, leaseExpiresAt: null }, now)).toBe(true);
    });
    it('claimed pending rows with a live lease are NOT claimable', () => {
      expect(
        isClaimable({ status: 'pending', claimedBy: 'w1', leaseExpiresAt: new Date(now.getTime() + 10_000) }, now),
      ).toBe(false);
    });
    it('claimed pending rows with an expired lease ARE claimable', () => {
      expect(
        isClaimable({ status: 'pending', claimedBy: 'w1', leaseExpiresAt: new Date(now.getTime() - 1) }, now),
      ).toBe(true);
    });
  });
});

describe('run-queue DB functions', () => {
  it('enqueue issues a single UPDATE', async () => {
    await enqueue('run-1');
    expect(captured.executed).toHaveLength(1);
    expect((captured.executed[0].sqlObj as { __sql?: boolean }).__sql).toBe(true);
  });

  it('claimNext returns the leased row from result.rows', async () => {
    captured.nextResult = { rows: [{ id: 'run-7', workflowId: 'wf-1', trigger: 'manual' }], rowCount: 1 };
    const row = await claimNext('homeserv:1:rand', DEFAULT_LEASE_MS);
    expect(row).toEqual({ id: 'run-7', workflowId: 'wf-1', trigger: 'manual' });
  });

  it('claimNext returns null when the queue is empty', async () => {
    captured.nextResult = { rows: [], rowCount: 0 };
    expect(await claimNext('w', DEFAULT_LEASE_MS)).toBeNull();
  });

  it('renewLease returns true only when a row was updated (rowCount>0)', async () => {
    captured.nextResult = { rows: [], rowCount: 1 };
    expect(await renewLease('run-1', 'w', 60_000)).toBe(true);
    captured.nextResult = { rows: [], rowCount: 0 };
    expect(await renewLease('run-1', 'other', 60_000)).toBe(false);
  });

  it('clearLease issues an UPDATE scoped to the worker', async () => {
    await clearLease('run-1', 'w');
    expect(captured.executed).toHaveLength(1);
  });

  it('releaseExpiredLeases returns the rowCount of released rows', async () => {
    captured.nextResult = { rows: [], rowCount: 3 };
    expect(await releaseExpiredLeases()).toBe(3);
  });
});
