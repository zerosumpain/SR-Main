// Safety (spec §5.5): crime economics, framed for players as Safety.
//
//   CP       = 25 · (1 + 2.5·u_£) · (1 + 1.2·Gini) · (1 + 0.3·DensityNorm) · (1 − 0.25·Fun/100)
//                 · (1 − 0.20·Edu/100) · (1 − 0.2·YouthClub) · PolicyMult
//   Crime(x) = clamp(CP · (0.6 + 0.8·dens(x)) · (1.3 − LV(x)/250) · (1 − 0.6·Pol(x)/(Pol(x) + 30)), 0, 100)
//   Safety   = 100 − population-weighted mean Crime
//
// Policing deters fast but saturates (Becker); prevention through Fun,
// education, youth clubs and jobs is slower and cheaper. A town that only
// attracts the rich breeds trouble through the Gini term. The Youth Club
// term is applied per cell (its catalogue effect is "within radius"), which
// makes the town-wide factor exactly the spec's YouthClubShare.
//
// M3 runs before M5, so unemployment and incomes here are M3's expectation
// from the stocks and the job slots (a top-down match by tier, out-commuters
// excused); WP2b's labour step is the authority on the month's actual
// figures.

import type { Params } from './params';
import { scratch, type SpaceModel } from './space';
import { CELLS } from './tiles';

export interface LabourGuess {
  workforce: number[];
  employed: number[];
  unemployed: number[];
  /** Unemployment share by tier. */
  u: number[];
  /** £ a month per person by tier (wages, pensions, support), and per student. */
  incomePerPerson: number[];
  studentIncome: number;
}

/**
 * M3's expected labour market: locals matched top-down by tier (£££ into
 * £££ slots, the leftover into ££ slots as underemployed, then ££ the same
 * way into £), against the town's job slots.
 */
export function expectedLabour(m: SpaceModel, outCommuters: readonly number[], p: Params): LabourGuess {
  const slots = [0, 0, 0];
  for (let h = 0; h < 3; h++) for (let d = 0; d < m.distJobsT[h].length; d++) slots[h] += m.distJobsT[h][d];
  const wf = m.workforce.map((w, h) => Math.max(0, w - (outCommuters[h] ?? 0)));
  const out = m.workforce.map((w, h) => Math.min(w, outCommuters[h] ?? 0));
  const W0 = p.labour.W0;
  const under = p.labour.underemployed;
  const e2 = Math.min(wf[2], slots[2]);
  let l2 = wf[2] - e2;
  const d2 = Math.min(l2, slots[1]);
  l2 -= d2;
  const e1 = Math.min(wf[1], slots[1] - d2);
  let l1 = wf[1] - e1;
  const d1 = Math.min(l1, slots[0]);
  l1 -= d1;
  const e0 = Math.min(wf[0], slots[0] - d1);
  const l0 = wf[0] - e0;
  const employed = [e0 + out[0], e1 + d1 + out[1], e2 + d2 + out[2]];
  const unemployed = [l0, l1, l2];
  const earn = [(e0 + out[0]) * W0[0], (e1 + out[1]) * W0[1] + d1 * W0[0] * under, (e2 + out[2]) * W0[2] + d2 * W0[1] * under];
  const P = (h: number) => m.tierPop[h];
  const pension = p.labour.pensionShare * W0[0];
  const support = p.labour.supportShare * W0[0];
  const incomePerPerson = [0, 1, 2].map((h) => (P(h) > 0 ? (earn[h] + pension * m.retireesByTier[h] + support * unemployed[h]) / P(h) : 0));
  return {
    workforce: m.workforce,
    employed,
    unemployed,
    u: unemployed.map((x, h) => x / Math.max(1, m.workforce[h])),
    incomePerPerson,
    studentIncome: p.labour.studentIncome,
  };
}

/**
 * The Gini coefficient over groups of (persons, income per person): Σ_i Σ_j
 * n_i n_j |y_i − y_j| / (2 N Σ n y). Four groups (three tiers and students)
 * keep it cheap.
 */
export function giniOf(n: readonly number[], y: readonly number[]): number {
  let N = 0;
  let tot = 0;
  for (let i = 0; i < n.length; i++) {
    N += n[i];
    tot += n[i] * y[i];
  }
  if (N <= 0 || tot <= 0) return 0;
  let s = 0;
  for (let i = 0; i < n.length; i++)
    for (let j = 0; j < n.length; j++) {
      const d = y[i] - y[j];
      s += n[i] * n[j] * (d < 0 ? -d : d);
    }
  return s / (2 * N * tot);
}

export interface CrimeInputs {
  /** £ unemployment share. */
  uL: number;
  gini: number;
  /** Population-weighted mean density, 0–1. */
  densityNorm: number;
  /** Town Fun coverage and the Edu stock, 0–100. */
  fun: number;
  edu: number;
  policy: number;
  /** Per cell: Youth Club reach 0–1, density 0–1, land value, police coverage, and population weights. */
  youth: Float64Array;
  dens: Float64Array;
  lv: Uint8Array;
  police: Float64Array;
  weights: Float64Array;
}

/** The factors a Why term can switch off (one at a time) to measure its effect. */
export type SafetyFactor = 'unemployment' | 'inequality' | 'density' | 'fun' | 'education' | 'youth' | 'police' | 'policy' | 'landValue';
export const SAFETY_FACTORS: readonly SafetyFactor[] = ['unemployment', 'inequality', 'density', 'fun', 'education', 'youth', 'police', 'policy', 'landValue'];

export interface CrimeResult {
  crime: Float64Array;
  /** Town crime pressure (with the Youth Club share folded in). */
  cp: number;
  safety: number;
}

/** CP without the per-cell Youth Club term (§5.5). */
export function crimePressure(i: CrimeInputs, p: Params, off: SafetyFactor | null = null): number {
  const s = p.safety;
  const u = off === 'unemployment' ? 0 : i.uL;
  const g = off === 'inequality' ? 0 : i.gini;
  const dn = off === 'density' ? 0 : i.densityNorm;
  const fun = off === 'fun' ? 0 : i.fun;
  const edu = off === 'education' ? 0 : i.edu;
  const pol = off === 'policy' ? 1 : i.policy;
  return s.base * (1 + s.unemployment * u) * (1 + s.inequality * g) * (1 + s.density * dn) * (1 - (s.fun * fun) / 100) * (1 - (s.education * edu) / 100) * pol;
}

interface SpatialFactors {
  youth: Float64Array;
  dens: Float64Array;
  lv: Float64Array;
  police: Float64Array;
  weights: Float64Array;
  /** Neutral values: no youth club, density ½, land value at the neutral point, no police. */
  neutral: { youth: number; dens: number; lv: number; police: number };
}

const FACTORS = new WeakMap<CrimeInputs, SpatialFactors>();
const NO_FIELD = new Float64Array(0);

/** The per-cell multipliers of Crime(x), computed once per inputs object. */
function spatial(i: CrimeInputs, p: Params): SpatialFactors {
  const hit = FACTORS.get(i);
  if (hit) return hit;
  const s = p.safety;
  const [db, ds] = s.densBase;
  const [la, ls] = s.lvTerm;
  const [pm, ph] = s.police;
  // Scratch: the factors live only as long as this month's inputs object.
  const youth = scratch('sf.youth', CELLS);
  const dens = scratch('sf.dens', CELLS);
  const lv = scratch('sf.lv', CELLS);
  const police = scratch('sf.police', CELLS);
  const weights = scratch('sf.weights', CELLS);
  let any = false;
  for (let c = 0; c < CELLS; c++) if (i.weights[c] > 0) any = true;
  for (let c = 0; c < CELLS; c++) {
    youth[c] = 1 - s.youth * i.youth[c];
    dens[c] = db + ds * i.dens[c];
    lv[c] = la - i.lv[c] / ls;
    const pol = i.police[c];
    police[c] = 1 - (pm * pol) / (pol + ph);
    weights[c] = any ? (i.weights[c] > 0 ? i.weights[c] : 0) : 1;
  }
  const out: SpatialFactors = { youth, dens, lv, police, weights, neutral: { youth: 1, dens: db + ds * 0.5, lv: 1, police: 1 } };
  FACTORS.set(i, out);
  return out;
}

/** Crime per cell and Safety; `off` neutralises one factor (for the Why terms). */
export function crimeField(i: CrimeInputs, p: Params, off: SafetyFactor | null = null, keepField = true): CrimeResult {
  const f = spatial(i, p);
  const cp0 = crimePressure(i, p, off);
  const crime = keepField ? new Float64Array(CELLS) : NO_FIELD;
  const Y = off === 'youth' ? null : f.youth;
  const D = off === 'density' ? null : f.dens;
  const L = off === 'landValue' ? null : f.lv;
  const P = off === 'police' ? null : f.police;
  const n = f.neutral;
  const w = f.weights;
  let wsum = 0;
  let csum = 0;
  let ysum = 0;
  for (let c = 0; c < CELLS; c++) {
    const y = Y ? Y[c] : n.youth;
    let v = cp0 * y * (D ? D[c] : n.dens) * (L ? L[c] : n.lv) * (P ? P[c] : n.police);
    v = v < 0 ? 0 : v > 100 ? 100 : v;
    if (keepField) crime[c] = v;
    const wc = w[c];
    if (wc > 0) {
      wsum += wc;
      csum += wc * v;
      ysum += wc * y;
    }
  }
  const mean = wsum > 0 ? csum / wsum : 0;
  return { crime, cp: cp0 * (wsum > 0 ? ysum / wsum : 1), safety: 100 - mean };
}

/**
 * Safety's Why terms: for each factor, Safety minus Safety with that factor
 * neutral (positive where the factor makes the town safer, like police).
 */
export function safetyTerms(i: CrimeInputs, p: Params, safety: number): [key: string, amount: number][] {
  const out: [string, number][] = [];
  const sp = spatial(i, p);
  const neutral = (a: Float64Array, v: number) => {
    for (let c = 0; c < CELLS; c++) if (a[c] !== v) return false;
    return true;
  };
  for (const f of SAFETY_FACTORS) {
    // A factor already at its neutral value explains nothing: skip the pass.
    if (f === 'unemployment' && i.uL === 0) continue;
    if (f === 'inequality' && i.gini === 0) continue;
    if (f === 'fun' && i.fun === 0) continue;
    if (f === 'education' && i.edu === 0) continue;
    if (f === 'policy' && i.policy === 1) continue;
    if (f === 'youth' && neutral(sp.youth, 1)) continue;
    if (f === 'police' && neutral(sp.police, 1)) continue;
    if (f === 'landValue' && neutral(sp.lv, 1)) continue;
    const d = safety - crimeField(i, p, f, false).safety;
    if (d !== 0) out.push([`safety.${f}`, d]);
  }
  return out;
}
