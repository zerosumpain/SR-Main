// What a worker can be asked to do: run a county spec, or run the G13
// founding check on one county seed. Plain data in and out, so jobs cross
// the worker boundary as structured clones.

import { brambleSteps, sprintTaps } from '../develop-kit';
import { applyCommand } from '../../../src/lib/games/hometowns/engine/commands';
import { createCounty } from '../../../src/lib/games/hometowns/engine/county';
import { catchUp } from '../../../src/lib/games/hometowns/engine/county';
import { nextRegionalDayAt } from '../../../src/lib/games/hometowns/engine/clock';
import { runCounty, LAB_EPOCH, type CountyResult, type CountySpec } from './run';
import type { Variant } from './variant';

export interface FoundingResult {
  seed: number;
  site: number;
  siteKind: string;
  /** Residents after the twelfth sprint tap. */
  pop: number;
  /** The meters Bramble's steps rely on (Homes £, Shops, Farms) at tap 3. */
  meters3: [number, number, number];
  error: string | null;
}

export type Job =
  | { kind: 'county'; spec: Omit<CountySpec, 'steps' | 'onDay'>; variant: Variant | null }
  | { kind: 'founding'; seed: number; variant: Variant | null };

export type JobResult = { kind: 'county'; results: CountyResult[] } | { kind: 'founding'; results: FoundingResult[] };

/**
 * G13 (A11, A12): the tutorial exactly as a child plays it on every site of
 * a county seed: Bramble's three steps (the canonical script, develop-kit),
 * then twelve taps of "Next week".
 */
export function runFounding(seed: number): FoundingResult[] {
  const c = createCounty({ seed, params: 'v1', settings: { rivalry: 'friendly', mishaps: 'mild', youngestOrder: [], perSeat: {} }, epoch: LAB_EPOCH, now: LAB_EPOCH });
  const at = nextRegionalDayAt(c) + 3_600_000;
  catchUp(c, at, Infinity);
  const out: FoundingResult[] = [];
  for (let site = 0; site < c.sites.length; site++) {
    const seat = `s${site}`;
    const now = at + site * 600_000;
    try {
      applyCommand(c, seat, { type: 'found', site, nameParts: ['Sunny', 'vale'], avatar: 'badger', flag: site }, now);
      brambleSteps(c, seat, now + 1000);
      const r = sprintTaps(c, seat, now + 2000);
      const m = r.meters[2];
      out.push({ seed, site, siteKind: c.sites[site].kind, pop: r.pop[r.pop.length - 1], meters3: [m[0], m[3], m[7]], error: null });
    } catch (e) {
      out.push({ seed, site, siteKind: c.sites[site].kind, pop: 0, meters3: [0, 0, 0], error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export function runJob(job: Job): JobResult {
  if (job.kind === 'founding') return { kind: 'founding', results: runFounding(job.seed) };
  return { kind: 'county', results: runCounty(job.spec) };
}
