// The Lab's orchestration: plan the jobs for a profile, run them on the
// pool, split the results by experiment, evaluate the gates against the
// baseline, and (optionally) a paired A/B, a sensitivity sweep and the
// off-rule identity runs. lab.ts is the command line over this; the tests
// call it directly.

import { ENGINE_HASH } from '../../../src/lib/games/hometowns/engine/engine-hash.generated';
import { hashOf } from '../../../src/lib/games/hometowns/engine/hash';
import { paramsFile, resolveParams } from '../../../src/lib/games/hometowns/engine/params';
import { buildJobs, PROFILES, type PlanConfig, type Profile } from './experiments';
import { evaluateGates, composite, type LabData } from './gates';
import type { FoundingResult, Job, JobResult } from './jobs';
import { runJobs } from './pool';
import type { CountyResult, TownSummary } from './run';
import { loadBaseline, regressions, type Baseline } from './baseline';
import { mean, pairedCI, round } from './stats';
import { scorecardOf, type AbMetric, type AbReport, type Scorecard, type SweepReport, type SweepRow } from './summary';
import { overriddenValue, sweepablePaths, type Variant } from './variant';
import { offRuleReport } from './offrule';

export interface LabOptions {
  profile: Profile;
  seeds?: number;
  days?: number;
  /** Seats per mixed county (default: the profile's). */
  seats?: number;
  workers?: number;
  variant?: Variant | null;
  /** Compare against this baseline (null: none). Default: the profile's file. */
  baseline?: Baseline | null;
  log?: (s: string) => void;
}

/** A params variant's hash, from a patched copy of the file (the main thread never applies variants). */
export function variantParamsHash(v: Variant | null): string {
  const file = JSON.parse(JSON.stringify(paramsFile('v1')));
  if (v)
    for (const [path, o] of Object.entries(v.overrides)) {
      let node = file;
      for (const k of path.split('.')) node = node[k];
      node.value = overriddenValue(path, o);
    }
  return hashOf(resolveParams(file));
}

export function configFor(o: Pick<LabOptions, 'profile' | 'seeds' | 'days' | 'seats'>): PlanConfig {
  const base = PROFILES[o.profile];
  return {
    ...base,
    seeds: o.seeds ?? base.seeds,
    days: o.days ?? base.days,
    seats: o.seats ?? base.seats,
    foundingSeeds: o.seeds !== undefined ? Math.min(base.foundingSeeds, o.seeds * 2) : base.foundingSeeds,
    timingSeeds: Math.min(base.timingSeeds, o.seeds ?? base.seeds),
    // Fewer seeds scale the side experiments down with the main run.
    g2b: base.g2b && o.seeds !== undefined ? { ...base.g2b, seeds: Math.max(1, Math.min(base.g2b.seeds, Math.ceil(o.seeds / 10))) } : base.g2b,
    pacing: base.pacing && o.seeds !== undefined ? { ...base.pacing, seeds: Math.max(1, Math.min(base.pacing.seeds, Math.ceil(o.seeds / 25))) } : base.pacing,
  };
}

export function splitResults(jobs: Job[], results: JobResult[], cfg: PlanConfig): LabData {
  const d: LabData = { mixed: [], g2b: [], pacing: [], founding: [], days: cfg.days, pacingDays: cfg.pacing?.days ?? 0 };
  results.forEach((r) => {
    if (r.kind === 'founding') d.founding.push(...(r.results as FoundingResult[]));
    else
      for (const c of r.results as CountyResult[]) {
        if (c.spec.experiment === 'g2b') d.g2b.push(c);
        else if (c.spec.experiment === 'pacing') d.pacing.push(c);
        else d.mixed.push(c);
      }
  });
  // Seed order, whatever order the pool finished in.
  d.mixed.sort((a, b) => a.spec.seed - b.spec.seed);
  d.founding.sort((a, b) => a.seed - b.seed || a.site - b.site);
  void jobs;
  return d;
}

/** Runs a profile and returns its scorecard (no files written). */
export async function runLab(o: LabOptions): Promise<{ scorecard: Scorecard; data: LabData }> {
  const t0 = performance.now();
  const cfg = configFor(o);
  const variant = o.variant ?? null;
  const jobs = buildJobs(cfg, variant);
  let last = 0;
  const results = await runJobs(jobs, {
    workers: o.workers,
    onResult: (done, total) => {
      const now = performance.now();
      if (o.log && (now - last > 5000 || done === total)) {
        last = now;
        o.log(`  ${done}/${total} jobs, ${Math.round((now - t0) / 1000)} s`);
      }
    },
  });
  const data = splitResults(jobs, results, cfg);
  const baseline = o.baseline === undefined ? loadBaseline(cfg.profile) : o.baseline;
  const gates = evaluateGates(data, { spectralThreshold: baseline?.spectralThreshold ?? null });
  const scorecard = scorecardOf({
    profile: cfg.profile,
    config: cfg,
    engineHash: ENGINE_HASH,
    paramsHash: variantParamsHash(variant),
    variant: variant?.label ?? null,
    wallMs: performance.now() - t0,
    workers: o.workers ?? -1,
    data,
    gates,
  });
  if (baseline) scorecard.regressions = regressions(scorecard, baseline);
  return { scorecard, data };
}

// ---- Paired A/B (§11.3) ------------------------------------------------------------------------

const lastOf = (xs: number[]) => xs[xs.length - 1] ?? 0;

const AB_METRICS: [string, (t: TownSummary) => number][] = [
  ['composite', composite],
  ['final population', (t) => lastOf(t.pop)],
  ['final happiness', (t) => lastOf(t.happy)],
  ['final reserves (£)', (t) => lastOf(t.reserves)],
  ['days in Helper Mode', (t) => t.helper.reduce((s, h) => s + h, 0)],
  ['highest tier', (t) => lastOf(t.tier)],
];

/** Pairs towns by (experiment, seed, seat, arm) and compares every metric with a paired bootstrap CI. */
export function abCompare(base: LabData, alt: LabData, variant: Variant, baseGates: Scorecard['gates'], altGates: Scorecard['gates']): AbReport {
  const key = (r: CountyResult, t: TownSummary) => `${r.spec.experiment}:${r.spec.seed}:${t.seat}:${r.arm ?? ''}`;
  const index = new Map<string, TownSummary>();
  for (const r of base.mixed) for (const t of r.towns) index.set(key(r, t), t);
  const pairs: [TownSummary, TownSummary][] = [];
  for (const r of alt.mixed) for (const t of r.towns) {
    const b = index.get(key(r, t));
    if (b) pairs.push([b, t]);
  }
  const metrics: AbMetric[] = AB_METRICS.map(([name, f]) => {
    const a = pairs.map(([x]) => f(x));
    const b = pairs.map(([, y]) => f(y));
    const diff = pairedCI(a, b, 1000, 71);
    const ma = mean(a);
    return { name, base: round(ma, 2), variant: round(mean(b), 2), diff, rel: round(ma !== 0 ? diff.est / Math.abs(ma) : 0, 4) };
  });
  return {
    variant: variant.label,
    overrides: variant.overrides,
    pairs: pairs.length,
    metrics,
    gates: baseGates.map((g) => ({ id: g.id, base: g.verdict, variant: altGates.find((x) => x.id === g.id)?.verdict ?? 'pending' })),
  };
}

export async function runAb(o: LabOptions & { variant: Variant }): Promise<{ base: Scorecard; alt: Scorecard; ab: AbReport }> {
  const { scorecard: base, data: d0 } = await runLab({ ...o, variant: null });
  const { scorecard: alt, data: d1 } = await runLab({ ...o });
  const ab = abCompare(d0, d1, o.variant, base.gates, alt.gates);
  base.ab = ab;
  return { base, alt, ab };
}

// ---- Sensitivity sweeps (§11.3) -------------------------------------------------------------------

/** §11.3's first sensitivity targets, by params path (the quick sweep). */
export const FIRST_TARGETS = [
  'migration.T',
  'migration.uphill',
  'migration.n0',
  'migration.poolExp',
  'migration.Kout',
  'develop.zScale',
  'develop.buildersBase',
  'develop.buildersPer',
  'meters.normalMargin',
  'labour.sigma',
  'stars.cultureTau',
  'tourism.poolBase',
  'housing.R0',
];

const SWEEP_OUTCOMES: [string, (t: TownSummary) => number][] = [
  ['population', (t) => lastOf(t.pop)],
  ['happiness', (t) => lastOf(t.happy)],
  ['reserves', (t) => Math.max(0, lastOf(t.reserves))],
  ['composite', composite],
];

export interface SweepOptions {
  paths?: string[];
  seeds?: number;
  days?: number;
  workers?: number;
  log?: (s: string) => void;
}

/**
 * ±20% on each parameter, one at a time, on six Balanced towns per seed.
 * Fragile: an outcome moves more than 2×. Dead: every outcome moves less
 * than 1% both ways (a candidate for deletion).
 */
export async function runSweep(o: SweepOptions): Promise<SweepReport> {
  const all = sweepablePaths();
  const paths = (o.paths ?? all).filter((p) => all.includes(p));
  const seeds = o.seeds ?? 2;
  const days = o.days ?? 10;
  const bots = ['balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced'];
  const mk = (variant: Variant | null): Job[] =>
    Array.from({ length: seeds }, (_, k) => ({ kind: 'county' as const, variant, spec: { experiment: 'sweep', seed: 30_000 + k, bots, days, observe: false, variant: variant?.label } }));
  const jobs: Job[] = [...mk(null)];
  for (const p of paths) jobs.push(...mk({ label: `${p}×0.8`, overrides: { [p]: { mul: 0.8 } } }), ...mk({ label: `${p}×1.2`, overrides: { [p]: { mul: 1.2 } } }));
  const results = await runJobs(jobs, { workers: o.workers, onResult: (d, n) => o.log && d % 20 === 0 && o.log(`  sweep ${d}/${n}`) });
  const byLabel = new Map<string, TownSummary[]>();
  results.forEach((r, i) => {
    const label = jobs[i].variant?.label ?? '';
    if (r.kind !== 'county') return;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(...r.results.flatMap((c) => c.towns));
  });
  const outcome = (ts: TownSummary[]) => Object.fromEntries(SWEEP_OUTCOMES.map(([n, f]) => [n, mean(ts.map(f))]));
  const base = outcome(byLabel.get('') ?? []);
  const rows: SweepRow[] = paths.map((p) => {
    const rel = (label: string) => {
      const o2 = outcome(byLabel.get(label) ?? []);
      return Object.fromEntries(Object.keys(base).map((k) => [k, round(base[k] !== 0 ? o2[k] / base[k] : o2[k] === 0 ? 1 : Infinity, 4)]));
    };
    const down = rel(`${p}×0.8`);
    const up = rel(`${p}×1.2`);
    const moves = [...Object.values(down), ...Object.values(up)];
    return {
      path: p,
      down,
      up,
      fragile: moves.some((r) => r > 2 || r < 0.5),
      dead: moves.every((r) => Math.abs(r - 1) < 0.01),
    };
  });
  return { seeds, days, outcomes: SWEEP_OUTCOMES.map(([n]) => n), base: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, round(v, 2)])), rows };
}

export { offRuleReport };
