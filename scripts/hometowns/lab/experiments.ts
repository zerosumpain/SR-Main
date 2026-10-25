// The Lab's experiments (spec §11.3) and how big each profile runs them.
//
//   mixed     6-bot counties, the standard run: two lineups that alternate by
//             seed, rotated across the six sites so every bot sees every
//             kind of site. Every gate reads it.
//   founding  G13: the tutorial on all six sites of a county seed.
//   g2b       G2b: six land-limited Balanced towns (no new parcels), forked
//             at `atDay` into a homes-tax 8% arm and a 16% arm, paired.
//   pacing    G3's Metropolis band: six Balanced towns for 84 days.
//
// Until WP3 lands, towns in a county do not touch each other (the Regional
// Day's settlement is a stub), so a 6-town county is six independent
// samples on six sites; the multiplayer gates say so and wait for M2.

import type { BotId } from '../../../src/lib/games/hometowns/engine/bots';
import type { Job } from './jobs';
import type { Variant } from './variant';

export type Profile = 'smoke' | 'quick' | 'full';

export interface PlanConfig {
  profile: Profile;
  seeds: number;
  days: number;
  /** Seeds of the mixed run that also time every tick and month (G12). */
  timingSeeds: number;
  foundingSeeds: number;
  g2b: { seeds: number; atDay: number; after: number } | null;
  pacing: { seeds: number; days: number } | null;
  /** First seed (A/B and sweeps shift it to stay off the gate seeds if asked). */
  seed0: number;
  /** Bots per county in the mixed run (the CI smoke uses 4). */
  seats: number;
}

export const PROFILES: Record<Profile, PlanConfig> = {
  // §12.1's smoke: 12 seeds × 20 days × a 4-town mixed county.
  smoke: { profile: 'smoke', seeds: 12, days: 20, timingSeeds: 2, foundingSeeds: 12, g2b: null, pacing: null, seed0: 1, seats: 4 },
  // The tuning loop (≤ 90 s on porkserv's 4 cores).
  quick: { profile: 'quick', seeds: 12, days: 20, timingSeeds: 2, foundingSeeds: 24, g2b: { seeds: 2, atDay: 10, after: 5 }, pacing: null, seed0: 1, seats: 6 },
  // The gate run (§11.3: ≥ 200 seeds × 60 days; 84 days for the Metropolis pacing runs).
  full: { profile: 'full', seeds: 200, days: 60, timingSeeds: 8, foundingSeeds: 200, g2b: { seeds: 20, atDay: 20, after: 10 }, pacing: { seeds: 8, days: 84 }, seed0: 1, seats: 6 },
};

/** The standard lineups (§11.2): Balanced in every county as the yardstick. */
export const LINEUPS: readonly (readonly BotId[])[] = [
  ['balanced', 'tourist', 'industrial', 'suburb', 'greedy', 'debt'],
  ['balanced', 'kid', 'weekly', 'absent', 'poacher', 'cooperator'],
  ['balanced', 'hermit', 'spammer', 'kid', 'absent', 'weekly'],
];

/** Seat order for a seed: lineup by seed, rotated by seed so each bot visits each site. */
export function lineupFor(seed: number, seats = 6): BotId[] {
  const L = LINEUPS[seed % LINEUPS.length];
  const r = Math.floor(seed / LINEUPS.length) % L.length;
  const rot = L.map((_, i) => L[(i + r) % L.length]);
  if (seats >= rot.length) return rot;
  // A smaller county keeps Balanced and the next seats of the rotation.
  const out: BotId[] = ['balanced'];
  for (const b of rot) if (b !== 'balanced' && out.length < seats) out.push(b);
  return out;
}

export function buildJobs(cfg: PlanConfig, variant: Variant | null = null): Job[] {
  const jobs: Job[] = [];
  for (let k = 0; k < cfg.seeds; k++) {
    const seed = cfg.seed0 + k;
    jobs.push({ kind: 'county', variant, spec: { experiment: 'mixed', seed, bots: lineupFor(seed, cfg.seats), days: cfg.days, variant: variant?.label } });
  }
  for (let k = 0; k < cfg.foundingSeeds; k++) jobs.push({ kind: 'founding', seed: cfg.seed0 + k, variant });
  if (cfg.g2b) {
    const g = cfg.g2b;
    for (let k = 0; k < g.seeds; k++)
      jobs.push({
        kind: 'county',
        variant,
        spec: {
          experiment: 'g2b',
          seed: 10_000 + cfg.seed0 + k,
          bots: ['balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced'],
          days: g.atDay + g.after,
          noParcels: true,
          fork: {
            atDay: g.atDay,
            arms: [
              { label: 'tax8', style: { homesTax: 800, taxBand: [800, 800] } },
              { label: 'tax16', style: { homesTax: 1600, taxBand: [1600, 1600] } },
            ],
          },
          variant: variant?.label,
        },
      });
  }
  if (cfg.pacing)
    for (let k = 0; k < cfg.pacing.seeds; k++)
      jobs.push({ kind: 'county', variant, spec: { experiment: 'pacing', seed: 20_000 + cfg.seed0 + k, bots: ['balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced'], days: cfg.pacing.days, variant: variant?.label } });
  // Longest first, so the pool's tail is short.
  // (The G12 timing runs are separate: timingJobs, run alone after the pool has drained.)
  const cost = (j: Job) => (j.kind === 'founding' ? 0 : j.spec.days * j.spec.bots.length * (j.spec.fork ? 1.5 : 1));
  return jobs.map((j, i) => [j, i] as const).sort((a, b) => cost(b[0]) - cost(a[0]) || a[1] - b[1]).map(([j]) => j);
}

/**
 * G12's timed counties: the first mixed lineups again, unobserved, run one at
 * a time after every other job has finished. Timing a county inside a busy
 * pool on four cores (and through the observer's bookkeeping) measured the
 * contention, not "Node on the VPS".
 */
export function timingJobs(cfg: PlanConfig, variant: Variant | null = null): Job[] {
  return timedCounties(cfg, variant);
}

/**
 * An untimed county run first in the timing worker. §10.15's budgets are
 * p95s of Node on the VPS, a long-running process whose engine code is hot;
 * a fresh worker's first county instead pays for V8 warming up (the month
 * steps run once a month per town, so they take hundreds of town-months to
 * reach optimised code; measured, a fresh worker's first county had ~330
 * deoptimisations, the next ~90 and a third ~15), which put about 1 ms on
 * the month step's p95. bench.ts warms up the same way before it times. Its result is
 * dropped.
 */
export function timingWarmup(cfg: PlanConfig, variant: Variant | null = null): Job | null {
  const first = timedCounties(cfg, variant)[0];
  if (!first || first.kind !== 'county') return null;
  return { ...first, spec: { ...first.spec, experiment: 'timing-warmup', timings: false } };
}

function timedCounties(cfg: PlanConfig, variant: Variant | null): Job[] {
  const jobs: Job[] = [];
  for (let k = 0; k < Math.min(cfg.timingSeeds, cfg.seeds); k++) {
    const seed = cfg.seed0 + k;
    jobs.push({ kind: 'county', variant, spec: { experiment: 'timing', seed, bots: lineupFor(seed, cfg.seats), days: cfg.days, timings: true, observe: false, variant: variant?.label } });
  }
  return jobs;
}
