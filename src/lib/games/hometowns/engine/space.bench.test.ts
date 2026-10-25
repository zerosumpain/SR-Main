// WP2a acceptance (§13.2, §10.15): the space package's share of the month
// step (M2 utilities + M3 fields + M4 transport) on the Metropolis fixture,
// against the 3 ms budget with a generous CI margin.
//
// The measurement that counts runs bundled code in a child Node (as the
// server and the page run the engine): a test runner's module shim turns
// every cross-module call into a property lookup and roughly doubles the
// time. It still shares the machine with the rest of the suite, which runs
// in parallel, so this is only a guard against a gross regression (on the
// median; the p95 is logged). A wall-clock limit in the PR gate fails at
// random on a loaded runner, so the §10.15 budgets are checked by
// `npx tsx scripts/hometowns/bench.ts --check` on a quiet machine, and the
// space share alone by `node scripts/hometowns/bench-space.mjs`.

import { describe, expect, it } from 'vitest';
import { bundledBench } from '../../../../../scripts/hometowns/bench-space.mjs';
import { benchSpace } from '../../../../../scripts/hometowns/space-bench';

const BUDGET_MS = 3;
/** CI runners are slower and shared: §10.15 allows 2×; this is generous on top. */
const CI_MARGIN = 3;
/** The p95 of a contended run is noise; this only catches something gone badly wrong. */
const P95_SLACK = 3;
/** Without esbuild the fallback runs in process and pays the module shim too. */
const SHIM = 2.5;

describe('the space month-step budget (Metropolis fixture)', () => {
  it('stays within the budget × margin, bundled as production runs it', async () => {
    const r = await bundledBench(120);
    if (r) {
      for (const x of r) {
        console.info(`[hometowns bench] space ${x.mode}: median ${x.median.toFixed(2)} ms, p95 ${x.p95.toFixed(2)} ms, max ${x.max.toFixed(2)} ms over ${x.months} months`);
        expect(x.median).toBeLessThan(BUDGET_MS * CI_MARGIN);
        expect(x.p95).toBeLessThan(BUDGET_MS * CI_MARGIN * P95_SLACK);
      }
      return;
    }
    // esbuild is a transitive dependency; without it, measure in process instead.
    const x = benchSpace({ now: () => performance.now() }, 'cold', 40, 10);
    console.info(`[hometowns bench] space in-process cold: median ${x.median.toFixed(2)} ms, p95 ${x.p95.toFixed(2)} ms`);
    expect(x.median).toBeLessThan(BUDGET_MS * CI_MARGIN * SHIM);
  }, 120_000);
});
