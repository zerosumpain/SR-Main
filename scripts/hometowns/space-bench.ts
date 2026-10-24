// WP2a's share of the month step (M2 utilities, M3 fields with coverage and
// safety and land value, M4 transport) timed on the Metropolis fixture, month
// after month with the stored lags evolving as they do in play.
//
// Two modes: "steady", where the town's road routes stay memoised between
// months (what a long-running server sees), and "cold", where the memo is
// dropped before every month (a revived town, or a month after a road edit or
// a congestion step, when every shortest-path tree is grown again).
//
// The numbers that matter come from bundled code (as the server and the page
// run it): `node scripts/hometowns/bench-space.mjs` bundles this file and runs
// it. Under a test runner's module shim the same code is about 2× slower.

import { fixture } from './fixture';
import { newDerivedCache } from '../../src/lib/games/hometowns/engine/derived';
import { stepFields } from '../../src/lib/games/hometowns/engine/fields';
import { makeContext } from '../../src/lib/games/hometowns/engine/tick';
import { forgetRoutes, stepTransport } from '../../src/lib/games/hometowns/engine/transport';
import { stepUtilities } from '../../src/lib/games/hometowns/engine/utilities';
import { MonthWhy } from '../../src/lib/games/hometowns/engine/why';

export interface BenchResult {
  mode: 'steady' | 'cold';
  months: number;
  median: number;
  p95: number;
  max: number;
}

export interface Clock {
  now(): number;
}

/** Times `months` month steps of M2–M4 after `warmup` untimed ones. */
export function benchSpace(clock: Clock, mode: 'steady' | 'cold', months = 240, warmup = 60): BenchResult {
  const f = fixture('metropolis');
  const t = f.county.towns[f.town];
  const times: number[] = [];
  for (let k = 0; k < warmup + months; k++) {
    if (mode === 'cold') forgetRoutes(t);
    const ctx = makeContext(f.county, f.town, t.tick);
    const m = { ...ctx, month: ctx.world.month, derived: newDerivedCache(), why: new MonthWhy() };
    const a = clock.now();
    stepUtilities(t, m);
    stepFields(t, m);
    stepTransport(t, m);
    const b = clock.now();
    if (k >= warmup) times.push(b - a);
    t.tick += 4;
  }
  times.sort((x, y) => x - y);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  return { mode, months, median: q(0.5), p95: q(0.95), max: times[times.length - 1] };
}
