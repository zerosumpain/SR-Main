// montecarlo.ts — uncertainty propagation (Monte-Carlo over effect-size bands) and
// one-at-a-time sensitivity (tornado) analysis. Self-contained.

import type { LeverState, MonteCarloResult, SensitivityBar, YearResult } from './types';
import { runSim } from './engine';
import type { Band } from './params';
import { LEVERS } from './levers';

// deterministic RNG so a given scenario yields stable bands across re-renders
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF sample from a triangular(low, central, high) distribution. */
function triangular(rng: () => number, a: number, c: number, b: number): number {
  if (b <= a) return c;
  const cc = Math.min(Math.max(c, a), b);
  const u = rng();
  const F = (cc - a) / (b - a);
  if (u < F) return a + Math.sqrt(u * (b - a) * (cc - a));
  return b - Math.sqrt((1 - u) * (b - a) * (b - cc));
}

/** Numeric YearResult fields exposed as Monte-Carlo / sensitivity outcomes. */
export const MC_KEYS = [
  'gapKS4', 'attainment8', 'attainment8Dis', 'grade5EM', 'ks2RWM', 'gld',
  'ehcpPct', 'highNeedsDeficitStock', 'persistentAbsence', 'neet', 'childPoverty',
  'cumulativeCost', 'teacherShortfall',
] as const;
export type McKey = (typeof MC_KEYS)[number];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export function runMonteCarlo(levers: LeverState, draws = 240, seed = 12345): MonteCarloResult {
  // collect[key][yearIndex] = array of draw values
  const collect: Record<string, number[][]> = {};
  let years: number[] = [];

  for (let d = 0; d < draws; d++) {
    const rng = mulberry32(seed + d * 2654435761);
    // A shared per-draw structural multiplier (correlated model uncertainty) applied on
    // top of independent per-parameter sampling. Without it, ~18 independent levers average
    // out (CLT) and the band collapses — understating genuine structural uncertainty.
    const structMult = Math.min(1.4, Math.max(0.6, triangular(rng, 0.78, 1.0, 1.28)));
    const sim = runSim(levers, {
      sample: (b: Band) => {
        const v = triangular(rng, b.low, b.central, b.high) * structMult;
        // fraction-type bands (high ≤ 1, e.g. fade-out, mitigation, substitution) must stay in [0,1]
        return b.high <= 1.0 ? Math.min(1, Math.max(0, v)) : v;
      },
    });
    if (d === 0) {
      years = sim.years.map((y) => y.year);
      for (const k of MC_KEYS) collect[k] = years.map(() => []);
    }
    sim.years.forEach((y, i) => {
      for (const k of MC_KEYS) collect[k][i].push(y[k] as number);
    });
  }

  const bands: MonteCarloResult['bands'] = {};
  for (const k of MC_KEYS) {
    const p10: number[] = [], p50: number[] = [], p90: number[] = [];
    for (let i = 0; i < years.length; i++) {
      const sorted = [...collect[k][i]].sort((a, b) => a - b);
      p10.push(percentile(sorted, 10));
      p50.push(percentile(sorted, 50));
      p90.push(percentile(sorted, 90));
    }
    bands[k] = { years, p10, p50, p90 };
  }
  return { draws, bands };
}

/** One-at-a-time sensitivity: swing each lever min→max, measure the KPI at `atYear`. */
export function runSensitivity(levers: LeverState, kpi: McKey, atYear: number): SensitivityBar[] {
  const yearIdx = (sim: ReturnType<typeof runSim>) =>
    Math.max(0, sim.years.findIndex((y) => y.year === atYear));
  const baseSim = runSim(levers);
  const baseVal = baseSim.years[yearIdx(baseSim)][kpi] as number;

  const bars: SensitivityBar[] = LEVERS.filter((L) => L.group !== 'identification').map((L) => {
    const lo = runSim({ ...levers, [L.id]: L.min });
    const hi = runSim({ ...levers, [L.id]: L.max });
    const low = lo.years[yearIdx(lo)][kpi] as number;
    const high = hi.years[yearIdx(hi)][kpi] as number;
    return { leverId: L.id, label: L.label, low, high, baseline: baseVal, swing: Math.abs(high - low) };
  });
  return bars.filter((b) => b.swing > 1e-4).sort((a, b) => b.swing - a.swing);
}

/** Convenience: a single central run (no uncertainty). */
export function central(levers: LeverState): YearResult[] {
  return runSim(levers).years;
}
