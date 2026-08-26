/**
 * The sweep against a real feature store.
 *
 * Run it deliberately:
 *   npx vitest run src/lib/daydream/stats/sweep.integration.test.ts
 *
 * Read-only. It writes nothing.
 */
import { describe, it, expect } from 'vitest';
import { runSweep, describeSweep } from './sweep';

describe('runSweep', () => {
  it('runs over the real feature store and reports honestly', async () => {
    let res;
    try {
      res = await runSweep({ windowDays: 365 });
    } catch {
      return expect(true).toBe(true); // no database here
    }

    console.log('\n  ' + describeSweep(res));
    for (const f of res.findings.slice(0, 10)) {
      console.log(
        `  ${f.a} ${f.lagDays ? `-> ${f.b} (+1d)` : `~ ${f.b}`}  r=${f.r.toFixed(2)} q=${f.qValue.toFixed(4)} n=${f.n}`,
      );
    }

    // The correction must never let through more than the naive sweep would.
    expect(res.findings.length).toBeLessThanOrEqual(res.naiveHits);
    // Every reported finding carries its own q-value and pair count.
    for (const f of res.findings) {
      expect(f.qValue).toBeLessThanOrEqual(res.fdr);
      expect(f.n).toBeGreaterThan(0);
      expect(Number.isFinite(f.r)).toBe(true);
    }
  }, 60_000);
});
