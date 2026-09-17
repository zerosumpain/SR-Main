/**
 * Executes `getRunLog` against a real database.
 *
 * Same reason as `$lib/releases/sessions.test.ts`: this module reads
 * `db.execute()` results, and `db.execute()` returns the driver's QueryResult
 * rather than an array. A cast to a row-array type compiles and then throws at
 * runtime, and no amount of type-checking or building will notice — only
 * calling the function does.
 */
import { describe, it, expect } from 'vitest';
import { getRunLog } from './runs.server';

describe('getRunLog', () => {
  it('executes against a real database and returns a usable shape', async () => {
    const log = await getRunLog(0);

    expect(Array.isArray(log.runs)).toBe(true);
    expect(Array.isArray(log.unattached)).toBe(true);
    expect(typeof log.hasMore).toBe('boolean');

    for (const key of ['calls', 'costUsd', 'attributedCalls', 'anonymousCalls', 'anonymousCostUsd'] as const) {
      expect(Number.isFinite(log.totals[key]), `totals.${key} is not a number`).toBe(true);
    }
    // The attribution figure the page renders as a percentage must not be able
    // to exceed the total it divides into.
    expect(log.totals.attributedCalls).toBeLessThanOrEqual(log.totals.calls);
    expect(log.totals.anonymousCalls).toBeLessThanOrEqual(log.totals.calls);

    for (const r of log.runs) {
      expect(typeof r.id).toBe('string');
      expect(['research', 'workflow', 'chat', 'unresolved']).toContain(r.kind);
      expect(Array.isArray(r.models)).toBe(true);
      expect(Array.isArray(r.activities)).toBe(true);
      expect(Number.isFinite(r.calls)).toBe(true);
      // An unresolved run is information, not a gap — it must still render, and
      // it is the one kind with no link to follow.
      if (r.kind === 'unresolved') expect(r.href).toBeNull();
      else expect(typeof r.href).toBe('string');
    }

    for (const u of log.unattached) {
      expect(typeof u.source).toBe('string');
      expect(Number.isFinite(u.calls)).toBe(true);
    }
  });
});
