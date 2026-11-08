/**
 * Runs the spend loader's SQL against a real database, for the reason
 * ./sessions.test.ts gives: a `db.execute()` result cast to the wrong shape
 * compiles, type-checks and passes every unit test, and then 500s the page.
 */
import { describe, it, expect } from 'vitest';
import { getSpendBand } from './spend.server';

describe('getSpendBand', () => {
  it('executes against a real database and returns a usable band', async () => {
    const band = await getSpendBand({});
    expect(Array.isArray(band.sessions)).toBe(true);
    expect(Array.isArray(band.areas)).toBe(true);
    expect(band.heat).toHaveLength(7);
    expect(Number.isFinite(band.totals.costUsd)).toBe(true);
    for (const s of band.sessions.slice(0, 20)) {
      expect(typeof s.id).toBe('string');
      expect(Number.isFinite(s.costUsd)).toBe(true);
    }
  });

  it('narrows to a date window', async () => {
    const band = await getSpendBand({ from: '2099-01-01', to: '2099-01-31' });
    expect(band.totals.sessions).toBe(0);
    expect(band.weeks).toEqual([]);
  });
});
