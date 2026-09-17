/**
 * These call the real functions against a real database, which is the whole
 * point of them.
 *
 * `/releases` went 500 for the owner on 2026-09-17 with `rows.map is not a
 * function`. `db.execute()` returns the driver's QueryResult — `{ rows, … }` —
 * not an array, and the code cast it straight to a row-array type. The cast
 * compiled, `svelte-check` passed with 0 errors across 7,599 files, the build
 * passed, and 9,256 tests passed, because **nothing ever executed the function**.
 *
 * A type assertion is a promise the compiler stops checking. The only thing that
 * catches a wrong one is running the code, so: run the code.
 */
import { describe, it, expect } from 'vitest';
import { db } from '$lib/db';
import { releases } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { getReleaseSessions } from './sessions.server';

describe('getReleaseSessions', () => {
  it('returns the empty band for no releases without touching the database', async () => {
    const band = await getReleaseSessions([]);
    expect(band.sessions).toEqual([]);
    expect(band.byRelease).toEqual({});
  });

  it('executes against a real database and returns a usable shape', async () => {
    const recent = await db.select({ id: releases.id }).from(releases).orderBy(desc(releases.deployedAt)).limit(25);
    if (!recent.length) return; // a fresh database has nothing to join

    const band = await getReleaseSessions(recent.map((r) => r.id));

    // The assertions that matter are structural: every field the template reads
    // must exist and be the type it claims, on real rows.
    expect(Array.isArray(band.sessions)).toBe(true);
    expect(typeof band.unlinkedInWindow).toBe('number');
    expect(typeof band.sessionsWithoutPrs).toBe('number');
    expect(Number.isFinite(band.unlinkedInWindow)).toBe(true);

    for (const s of band.sessions) {
      expect(typeof s.id).toBe('string');
      expect(Array.isArray(s.stages)).toBe(true);
      expect(Array.isArray(s.pullRequests)).toBe(true);
      expect(Array.isArray(s.releaseIds)).toBe(true);
      expect(s.releaseIds.length).toBeGreaterThan(0);
      for (const st of s.stages) {
        expect(typeof st.stage).toBe('string');
        expect(typeof st.ordinal).toBe('number');
      }
      // byRelease must agree with the rows it was built from.
      for (const rid of s.releaseIds) expect(band.byRelease[rid]).toContain(s.id);
    }
  });
});
