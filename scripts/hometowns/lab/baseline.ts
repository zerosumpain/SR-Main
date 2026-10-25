// Baselines (spec §11.4: "baselines in scripts/hometowns/baselines/"; §11.5:
// a balance PR must not regress any baseline). A baseline is a small slice
// of a scorecard: each gate's verdict and a handful of headline numbers per
// bot, with the direction that counts as better. A run regresses when a gate
// that passed now fails, or a number moves the wrong way by more than the
// profile's tolerance (a quick run is noisier, so its band is wider).
//
// G10's spectral threshold is set by the FIRST baseline and carried forward
// unchanged ("stays below the first baseline's threshold").

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scorecard } from './summary';
import type { Verdict } from './gates';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASELINE_DIR = join(HERE, '..', 'baselines');

export interface BaselineMetric {
  value: number;
  /** +1: higher is better; −1: lower is better. */
  better: 1 | -1;
}

export interface Baseline {
  schema: 1;
  profile: string;
  createdAt: string;
  engineHash: string;
  paramsHash: string;
  seeds: number;
  days: number;
  gates: Record<string, Verdict>;
  metrics: Record<string, BaselineMetric>;
  spectralThreshold: number;
}

/** Tolerance before a move counts as a regression. */
export const TOLERANCE: Record<string, number> = { smoke: 0.3, quick: 0.2, full: 0.1 };

/** The numbers a baseline keeps from a scorecard. */
export function baselineMetrics(s: Scorecard): Record<string, BaselineMetric> {
  const out: Record<string, BaselineMetric> = {};
  for (const b of s.bots) {
    out[`${b.bot}.finalPop`] = { value: b.finalPop.est, better: 1 };
    out[`${b.bot}.happy`] = { value: b.happy, better: 1 };
    out[`${b.bot}.composite`] = { value: b.composite, better: 1 };
    b.tierDays.forEach((d, k) => {
      if (d !== null) out[`${b.bot}.day.tier${k + 1}`] = { value: d, better: -1 };
    });
  }
  for (const g of s.gates)
    for (const c of g.checks)
      if (typeof c.value === 'number' && c.ok !== null && !c.provisional && (g.id === 'G9' || g.id === 'G8' || g.id === 'G13'))
        out[`${g.id}.${c.name}`] = { value: c.value, better: 1 };
  return out;
}

export function baselinePath(profile: string): string {
  return join(BASELINE_DIR, `v1.${profile}.json`);
}

export function loadBaseline(profile: string, dir = BASELINE_DIR): Baseline | null {
  const p = join(dir, `v1.${profile}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Baseline;
}

export function makeBaseline(s: Scorecard, previous: Baseline | null): Baseline {
  const gates: Record<string, Verdict> = {};
  for (const g of s.gates) gates[g.id] = g.verdict;
  return {
    schema: 1,
    profile: s.profile,
    createdAt: s.createdAt,
    engineHash: s.engineHash,
    paramsHash: s.paramsHash,
    seeds: s.config.seeds,
    days: s.config.days,
    gates,
    metrics: baselineMetrics(s),
    spectralThreshold: previous?.spectralThreshold ?? Math.max(1, s.stability.spectralP95 * 1.25),
  };
}

export function writeBaseline(b: Baseline, dir = BASELINE_DIR): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `v1.${b.profile}.json`);
  writeFileSync(p, JSON.stringify(b, null, 2) + '\n');
  return p;
}

/** What got worse since the baseline (empty: no regression). */
export function regressions(s: Scorecard, b: Baseline): string[] {
  const out: string[] = [];
  const tol = TOLERANCE[s.profile] ?? 0.2;
  for (const g of s.gates) if (b.gates[g.id] === 'pass' && g.verdict === 'fail') out.push(`${g.id} passed in the baseline and fails now`);
  const now = baselineMetrics(s);
  for (const [k, m] of Object.entries(b.metrics)) {
    const cur = now[k];
    if (!cur) {
      // A milestone the baseline reached and this run does not is the worst kind of slower.
      if (k.includes('.day.tier')) out.push(`${k}: reached by day ${m.value} in the baseline, not reached now`);
      continue;
    }
    const scale = Math.max(Math.abs(m.value), 1e-9);
    const worse = m.better === 1 ? (m.value - cur.value) / scale : (cur.value - m.value) / scale;
    // Days are small integers: allow one day on top of the share.
    const slack = k.includes('.day.') ? Math.max(tol, 1 / scale) : tol;
    if (worse > slack) out.push(`${k}: ${round3(m.value)} → ${round3(cur.value)} (${worse > 0 ? '−' : '+'}${Math.round(Math.abs(worse) * 100)}%, tolerance ${Math.round(slack * 100)}%)`);
  }
  return out;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
