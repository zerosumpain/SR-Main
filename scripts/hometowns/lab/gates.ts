// The gates (spec §11.4): a params or engine change fails if any gate fails.
// Each gate is a list of checks with the number measured, the target, a
// confidence interval where the number is a sample statistic, and a verdict.
// A check that needs a package that has not landed yet (WP3's settlement,
// awards and links) is reported as pending with the reason, never silently
// passed. Where a single-town proxy can be measured now it is shown,
// labelled provisional, so the trend is visible before M2.
//
// M0's exit (§13.3) needs G3 (its single-town parts), G8, G9, G10 and G12.

import { lintCatalogue } from '../../../src/lib/games/hometowns/engine/content';
import { paramsFor } from '../../../src/lib/games/hometowns/engine/params';
import type { BotId } from '../../../src/lib/games/hometowns/engine/bots';
import { METERS } from '../../../src/lib/games/hometowns/engine/types';
import type { FoundingResult } from './jobs';
import type { CountyResult, TownSummary } from './run';
import { bootstrap, correlation, dominantCycle, gini, longestRun, maxInWindow, mean, median, quantile, ratioCI, round, shareCI, signChanges, type CI } from './stats';
import { maxOf } from './stats';

export interface LabData {
  mixed: CountyResult[];
  /** G12's timed counties, run alone after the pool (absent in older data: then timed mixed runs are used). */
  timing?: CountyResult[];
  g2b: CountyResult[];
  pacing: CountyResult[];
  founding: FoundingResult[];
  days: number;
  pacingDays: number;
}

export type Verdict = 'pass' | 'fail' | 'pending';

export interface Check {
  name: string;
  value: number | string | null;
  target: string;
  ok: boolean | null;
  ci?: CI;
  n?: number;
  /** Why it is pending, or what the provisional number stands in for. */
  note?: string;
  provisional?: boolean;
}

export interface GateResult {
  id: string;
  title: string;
  verdict: Verdict;
  /** Part of M0's exit (§13.3). */
  m0: boolean;
  checks: Check[];
  note?: string;
}

export interface BaselineRef {
  /** G10: the first baseline's p95 spectral peak ratio of monthly growth, × the margin. */
  spectralThreshold: number | null;
}

// ---- Helpers ---------------------------------------------------------------------------------------

const towns = (rs: CountyResult[], bot?: BotId) => rs.flatMap((r) => r.towns).filter((t) => !bot || t.bot === bot);

/** Day a tier was reached (Infinity if never). */
const dayOf = (t: TownSummary, tier: number) => t.tierDay[tier - 1] ?? Infinity;

/** The G1 composite: population × mean happiness × solvency × award share (1 until WP3's awards). */
export function composite(t: TownSummary): number {
  const n = t.pop.length;
  if (n === 0) return 0;
  const pop = t.pop[n - 1];
  const happy = t.happy[n - 1] / 100;
  const helperDays = t.helper.reduce((s, h) => s + h, 0);
  const solvency = 1 - helperDays / n;
  return pop * happy * solvency;
}

function maxConsecutive(xs: number[]): number {
  return longestRun(xs, (x) => x > 0);
}

/** The deepest fall below the running peak, as a share of the peak (from day 1). */
export function drawdown(pop: number[]): number {
  let peak = 0;
  let worst = 0;
  for (const p of pop) {
    peak = Math.max(peak, p);
    if (peak > 0) worst = Math.max(worst, 1 - p / peak);
  }
  return worst;
}

/**
 * Helper Mode episodes as [length in days, ended before the run did]. A town
 * written off at day 10 can re-enter at a later month of the same day, so a
 * run of Helper days is split wherever the episode's start day changes.
 */
function helperEpisodes(h: number[], since: readonly number[] = []): [number, boolean][] {
  const out: [number, boolean][] = [];
  let run = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i] && run && since.length > i && since[i] !== since[i - 1]) {
      out.push([run, true]);
      run = 0;
    }
    if (h[i]) run++;
    else if (run) {
      out.push([run, true]);
      run = 0;
    }
  }
  if (run) out.push([run, false]);
  return out;
}

const verdictOf = (checks: Check[]): Verdict => (checks.some((c) => c.ok === false && !c.provisional) ? 'fail' : checks.some((c) => c.ok === null && !c.provisional) ? 'pending' : checks.every((c) => c.provisional) ? 'pending' : 'pass');

const pend = (name: string, target: string, note = 'needs M2 (WP3 settlement, links and awards)'): Check => ({ name, value: null, target, ok: null, note });

/** Meters a tier cannot act on (zones it cannot build) are not stability signals: leisure and offices before Town, farms from City. */
function meterLive(meter: number, tier: number): boolean {
  if (meter === 4 || meter === 6) return tier >= 2;
  if (meter === 7) return tier <= 2;
  return true;
}

// ---- The gates ---------------------------------------------------------------------------------------

function g1(d: LabData): GateResult {
  const bal = towns(d.mixed, 'balanced').map(composite);
  const checks: Check[] = [];
  for (const bot of ['tourist', 'industrial', 'suburb', 'greedy', 'debt', 'poacher', 'kid', 'weekly', 'spammer'] as BotId[]) {
    const xs = towns(d.mixed, bot).map(composite);
    if (xs.length < 2 || bal.length < 2) continue;
    const ci = ratioCI(xs, bal, 1000, 11);
    checks.push({ name: `${bot} ÷ Balanced composite`, value: round(ci.est), target: '≤ 1.15 at the CI low end', ok: ci.lo <= 1.15, ci, n: xs.length, provisional: true, note: 'solo towns, no award share yet' });
  }
  checks.push(pend('Tourist, Industrial, Suburb and Balanced within ±15%', 'all ratios in [0.85, 1.15]'));
  return { id: 'G1', title: 'No dominant strategy', verdict: verdictOf(checks), m0: false, checks, note: 'Composite = population × mean happiness × solvency × award share (award share is 1 until WP3).' };
}

function g2(d: LabData): GateResult {
  const checks: Check[] = [];
  for (const bot of ['greedy', 'debt'] as BotId[]) {
    const flags: boolean[] = [];
    for (const r of d.mixed) {
      const b = r.towns.find((t) => t.bot === 'balanced');
      const x = r.towns.find((t) => t.bot === bot);
      if (b && x) flags.push(composite(x) < composite(b));
    }
    if (flags.length === 0) continue;
    const ci = shareCI(flags, 1000, 12);
    checks.push({ name: `${bot} finishes below Balanced (same county)`, value: round(ci.est), target: '≥ 0.80 of seeds', ok: ci.est >= 0.8, ci, n: flags.length });
  }
  checks.push(pend('Best fixed homes tax differs between compositions', '≥ 30% of configurations'));
  return { id: 'G2', title: 'Emergent Laffer', verdict: verdictOf(checks), m0: false, checks };
}

function g2b(d: LabData): GateResult {
  const byKey = new Map<string, { a?: TownSummary; b?: TownSummary }>();
  for (const r of d.g2b) for (const t of r.towns) {
    const k = `${r.spec.seed}:${t.seat}`;
    const e = byKey.get(k) ?? {};
    if (r.arm === 'tax8') e.a = t;
    if (r.arm === 'tax16') e.b = t;
    byKey.set(k, e);
  }
  const score = (t: TownSummary) => {
    const n = t.pop.length;
    const k = Math.min(3, n);
    let s = 0;
    for (let i = n - k; i < n; i++) s += t.pop[i] * t.happy[i];
    return s / Math.max(1, k);
  };
  const flags: boolean[] = [];
  const ratios: number[] = [];
  let limited = 0;
  for (const { a, b } of byKey.values()) {
    if (!a || !b) continue;
    // Land-limited: no free lots left in the 8% arm (it filled its land) and no parcels opened since founding's four.
    if (a.freeLots > 10) continue;
    limited++;
    const r = score(b) / Math.max(1, score(a));
    ratios.push(r);
    flags.push(r <= 0.95);
  }
  const checks: Check[] = [];
  if (flags.length === 0) checks.push({ name: 'Land-limited pairs', value: 0, target: '> 0', ok: d.g2b.length === 0 ? null : false, note: d.g2b.length === 0 ? 'not run in this profile' : 'no town filled its land before the fork' });
  else {
    const ci = shareCI(flags, 1000, 13);
    checks.push({ name: 'Homes tax 8% → 16% lowers pop × happiness by ≥ 5%', value: round(ci.est), target: '≥ 0.80 of seeds', ok: ci.est >= 0.8, ci, n: flags.length });
    checks.push({ name: 'Median 16% ÷ 8% pop × happiness', value: round(median(ratios)), target: 'info', ok: null, provisional: true, n: limited });
  }
  return { id: 'G2b', title: 'Tax still hurts when land runs out (A13)', verdict: verdictOf(checks), m0: false, checks };
}

function g13(d: LabData): GateResult {
  const p = paramsFor('v1');
  const lint = lintCatalogue(p.utilities.exportPower, p.utilities.exportWater);
  const checks: Check[] = [{ name: 'Catalogue lint (A14)', value: lint.length === 0 ? 'clean' : `${lint.length} findings: ${lint.slice(0, 2).join('; ')}`, target: 'no findings', ok: lint.length === 0 }];
  const f = d.founding.filter((x) => !x.error);
  if (d.founding.length) {
    const inBand = shareCI(f.map((x) => x.pop >= 60 && x.pop <= 120), 1000, 14);
    checks.push({ name: 'Residents after 12 sprint ticks in 60–120', value: round(inBand.est), target: '≥ 0.90 of sites', ok: inBand.est >= 0.9, ci: inBand, n: f.length, note: `median ${median(f.map((x) => x.pop))}, errors ${d.founding.length - f.length}` });
    const pos = shareCI(f.map((x) => x.meters3.every((m) => m > 0)), 1000, 15);
    checks.push({ name: 'Homes £, Shops and Farms meters positive at tap 3', value: round(pos.est), target: '≥ 0.90 of sites', ok: pos.est >= 0.9, ci: pos, n: f.length });
  } else checks.push(pend('Founding runs', '≥ 90% in band', 'not run in this profile'));
  checks.push(...calibration(d));
  return { id: 'G13', title: 'Catalogue and start (A11, A14)', verdict: verdictOf(checks), m0: false, checks };
}

/** §5.13's calibration table: £ per resident per month at default taxes, by tier (Metropolis is not reached at M0). */
export const CALIBRATION: readonly [string, number, number][] = [
  ['Hamlet', 22, 18],
  ['Village', 32, 31],
  ['Town', 86, 77],
  ['City', 120, 108],
  ['Metropolis', 150, 140],
];

/**
 * A14 says the Lab hits this table with civicUpkeepScale. Balanced towns'
 * town-months by tier (from month 4 of a tier, so the arrival month's
 * one-offs do not count), within ±25%. Provisional at M0: reported and
 * tracked, but the economy has not been retuned to it yet, so it does not
 * fail the gate.
 */
function calibration(d: LabData): Check[] {
  const rev: number[][] = CALIBRATION.map(() => []);
  const up: number[][] = CALIBRATION.map(() => []);
  for (const t of towns(d.mixed, 'balanced')) {
    const mo = t.monthly;
    if (!mo.tier || !mo.revPer || !mo.upkeepPer) continue;
    let since = 0;
    for (let k = 0; k < mo.tier.length; k++) {
      since = k > 0 && mo.tier[k] === mo.tier[k - 1] ? since + 1 : 0;
      if (since < 4 || (mo.pop[k] ?? 0) < 50) continue;
      rev[mo.tier[k]]?.push(mo.revPer[k]);
      up[mo.tier[k]]?.push(mo.upkeepPer[k]);
    }
  }
  const out: Check[] = [];
  CALIBRATION.forEach(([name, r, u], tier) => {
    if (rev[tier].length < 12) return;
    const mr = median(rev[tier]);
    const mu = median(up[tier]);
    const ok = Math.abs(mr / r - 1) <= 0.25 && Math.abs(mu / u - 1) <= 0.25;
    out.push({
      name: `§5.13 calibration at ${name}: revenue / upkeep per resident`,
      value: `£${round(mr, 1)} / £${round(mu, 1)}`,
      target: `£${r} / £${u} ±25%`,
      ok,
      provisional: true,
      n: rev[tier].length,
      note: 'Balanced towns, median town-month; provisional until the economy is retuned to the table',
    });
  });
  return out;
}

function g3(d: LabData): GateResult {
  const checks: Check[] = [];
  const bands: [number, string, number, number, LabData['mixed'], number][] = [
    [1, 'Village', 1, 2, d.mixed, d.days],
    [2, 'Town', 5, 8, d.mixed, d.days],
    [3, 'City', 18, 28, d.mixed, d.days],
    [4, 'Metropolis', 50, 75, d.pacing.length ? d.pacing : d.mixed, d.pacing.length ? d.pacingDays : d.days],
  ];
  for (const [tier, name, lo, hi, rs, days] of bands) {
    const xs = towns(rs, 'balanced').map((t) => dayOf(t, tier));
    const lo3 = lo * 0.7;
    const hi3 = hi * 1.3;
    if (xs.length === 0) {
      checks.push(pend(`Balanced reaches ${name}`, `day ${lo}–${hi} (±30%)`, 'no runs'));
      continue;
    }
    const med = median(xs);
    const ci = bootstrap(xs, median, 1000, 20 + tier);
    const tooShort = !Number.isFinite(med) && days < hi3;
    checks.push({
      name: `Balanced median day to ${name}`,
      value: Number.isFinite(med) ? round(med, 1) : `not by day ${days}`,
      target: `${round(lo3, 1)}–${round(hi3, 1)} (day ${lo}–${hi} ±30%)`,
      ok: tooShort ? null : med >= lo3 && med <= hi3,
      ci,
      n: xs.length,
      note: tooShort ? `run too short (${days} days)` : undefined,
    });
  }
  const kid = towns(d.mixed, 'kid').map((t) => dayOf(t, 2));
  if (kid.length) {
    const med = median(kid);
    const short = !Number.isFinite(med) && d.days < 18.2;
    checks.push({ name: 'Kid median day to Town', value: Number.isFinite(med) ? round(med, 1) : `not by day ${d.days}`, target: '≤ 18.2 (day 14 +30%)', ok: short ? null : med <= 18.2, ci: bootstrap(kid, median, 1000, 31), n: kid.length, note: short ? `run too short (${d.days} days)` : undefined });
  }
  const balTown = median(towns(d.mixed, 'balanced').map((t) => dayOf(t, 2)));
  const balCity = median(towns(d.mixed, 'balanced').map((t) => dayOf(t, 3)));
  for (const [tier, name, bal] of [[2, 'Town', balTown], [3, 'City', balCity]] as const) {
    const w = towns(d.mixed, 'weekly').map((t) => dayOf(t, tier));
    if (!w.length) continue;
    const med = median(w);
    const ratio = med / bal;
    const unknown = !Number.isFinite(bal) || (!Number.isFinite(med) && d.days < 1.6 * bal);
    checks.push({ name: `Weekly ÷ Balanced days to ${name}`, value: Number.isFinite(ratio) ? round(ratio, 2) : 'n/a', target: '≤ 1.6', ok: unknown ? null : ratio <= 1.6, n: w.length, note: unknown ? 'not reached in the run' : undefined });
  }
  return { id: 'G3', title: 'Pacing', verdict: verdictOf(checks), m0: true, checks, note: 'Day n = the nth Regional Day after an evening founding.' };
}

function g4(): GateResult {
  const checks = [pend('Cooperator pairs beat Poacher pairs', '≥ +10% combined population'), pend('A completed Great Work beats the same seeds without', 'happiness and population'), pend("Poacher's victim loses ≤ 8% to players per season", '≤ 0.08')];
  return { id: 'G4', title: 'Co-operation pays', verdict: 'pending', m0: false, checks };
}

function g5(): GateResult {
  return { id: 'G5', title: 'Specialisation', verdict: 'pending', m0: false, checks: [pend('Suburb + Industrial pair outgrows two Balanced towns', '+5% to +20% combined')] };
}

function g6(): GateResult {
  const checks = [pend('Newcomers from players (Friendly)', '10–20%'), pend('Newcomers from players (Spirited)', '20–30%'), pend('Worst weekly loss to players', '≤ 5% (≤ 3% shielded)')];
  return { id: 'G6', title: 'Gentle rivalry', verdict: 'pending', m0: false, checks };
}

function g7(d: LabData): GateResult {
  const checks: Check[] = [pend('Median county Gini at day 60 among equal-skill bots', '< 0.35')];
  const ratios: number[] = [];
  for (const r of d.mixed) {
    const b = r.towns.find((t) => t.bot === 'balanced');
    for (const k of r.towns.filter((t) => t.bot === 'kid')) if (b) ratios.push(k.pop[k.pop.length - 1] / Math.max(1, b.pop[b.pop.length - 1]));
  }
  if (ratios.length) checks.push({ name: 'Kid ÷ Balanced size (same county)', value: round(median(ratios)), target: '≥ 0.35', ok: median(ratios) >= 0.35, provisional: true, n: ratios.length, note: 'towns do not interact until WP3' });
  const g = d.mixed.map((r) => gini(r.towns.map((t) => t.pop[t.pop.length - 1])));
  if (g.length) checks.push({ name: 'Median Gini of mixed counties (unequal skills, no interaction)', value: round(median(g)), target: 'info', ok: null, provisional: true });
  return { id: 'G7', title: 'No runaway', verdict: 'pending', m0: false, checks };
}

function g8(d: LabData): GateResult {
  const abs = towns(d.mixed, 'absent');
  if (!abs.length) return { id: 'G8', title: 'Absence safety', verdict: 'pending', m0: true, checks: [pend('Absent runs', '> 0', 'no Absent seat in this profile')] };
  const village = shareCI(abs.map((t) => t.tier[t.tier.length - 1] >= 1), 1000, 41);
  const helper = shareCI(abs.map((t) => maxConsecutive(t.helper) <= 3), 1000, 42);
  const dd = abs.map((t) => drawdown(t.pop));
  const fall = shareCI(dd.map((x) => x <= 0.15), 1000, 43);
  const checks: Check[] = [
    { name: 'Absent reaches Village', value: round(village.est), target: '≥ 0.95 of runs', ok: village.est >= 0.95, ci: village, n: abs.length, note: `median day ${median(abs.map((t) => dayOf(t, 1)))}` },
    { name: 'Never more than 3 days in a row in Helper Mode', value: round(helper.est), target: '≥ 0.95 of runs', ok: helper.est >= 0.95, ci: helper, n: abs.length },
    { name: 'Never more than 15% below its peak', value: round(fall.est), target: '≥ 0.95 of runs', ok: fall.est >= 0.95, ci: fall, n: abs.length, note: `worst ${round(maxOf(dd), 3)}, median ${round(median(dd), 3)}` },
  ];
  return { id: 'G8', title: 'Absence safety', verdict: verdictOf(checks), m0: true, checks };
}

function g9(d: LabData): GateResult {
  const pop: number[] = [];
  const rev: number[] = [];
  for (const t of towns(d.mixed)) {
    for (const x of t.monthly.whyPop) if (x >= 0) pop.push(x);
    for (const x of t.monthly.whyRev) if (x >= 0) rev.push(x);
  }
  const checks: Check[] = [];
  for (const [name, xs, seed] of [['population', pop, 51], ['revenue', rev, 52]] as const) {
    if (!xs.length) {
      checks.push(pend(`Top-3 Why terms cover ≥ 70% of ${name}`, '≥ 0.95 of town-months', 'no observed months'));
      continue;
    }
    const ci = shareCI(xs.map((x) => x >= 0.7), 300, seed);
    checks.push({ name: `Town-months where the top 3 terms explain ≥ 70% of ${name}`, value: round(ci.est), target: '≥ 0.95', ok: ci.est >= 0.95, ci, n: xs.length, note: `median share ${round(median(xs))}, p5 ${round(quantile(xs, 0.05))}` });
  }
  return { id: 'G9', title: 'Explainability', verdict: verdictOf(checks), m0: true, checks, note: 'Share = Σ|top 3 terms| ÷ Σ|all terms| of the month (every term the steps added, observed live).' };
}

export interface StabilityStats {
  /** Per METER: p99 flips in 30 days and p99 pinned months, so a report can name the culprit. */
  byMeter: { meter: string; flipsP99: number; pinnedP99: number }[];
  flipsP99: number;
  flipsMax: number;
  pinnedP99: number;
  pinnedMax: number;
  pressureAmp: number;
  cyclicShortShare: number;
  spectralP95: number;
}

export function stability(d: LabData): StabilityStats {
  const flips: number[] = [];
  const pinned: number[] = [];
  const meterFlips: number[][] = METERS.map(() => []);
  const meterPinned: number[][] = METERS.map(() => []);
  const amp: number[] = [];
  const shortCycles: boolean[] = [];
  const peaks: number[] = [];
  const window = 30 * 12;
  for (const t of towns(d.mixed)) {
    const mo = t.monthly;
    if (mo.months < 24) continue;
    const tiers = mo.tier ?? [];
    for (let k = 0; k < 8; k++) {
      const series: number[] = [];
      for (let i = 0; i < mo.months; i++) if (meterLive(k, tiers[i] ?? 0)) series.push(mo.meters[i][k]);
      if (series.length < 12) continue;
      const f = maxInWindow(signChanges(series, 5), window);
      const pin = longestRun(series, (x) => Math.abs(x) >= 99);
      flips.push(f);
      pinned.push(pin);
      meterFlips[k].push(f);
      meterPinned[k].push(pin);
    }
    const pr = mo.pressure.slice(24);
    if (pr.length >= 48) {
      const m = mean(pr);
      const a = m > 1e-3 ? (quantile(pr, 0.9) - quantile(pr, 0.1)) / 2 / m : 0;
      amp.push(a);
      if (a >= 0.1) shortCycles.push(dominantCycle(pr).period <= 24);
    }
    const g: number[] = [];
    for (let i = 25; i < mo.pop.length; i++) g.push((mo.pop[i] - mo.pop[i - 1]) / Math.max(1, mo.pop[i - 1]));
    if (g.length >= 48) peaks.push(dominantCycle(g).peakRatio);
  }
  return {
    byMeter: METERS.map((meter, k) => ({ meter, flipsP99: meterFlips[k].length ? quantile(meterFlips[k], 0.99) : 0, pinnedP99: meterPinned[k].length ? quantile(meterPinned[k], 0.99) : 0 })),
    flipsP99: flips.length ? quantile(flips, 0.99) : 0,
    flipsMax: flips.length ? maxOf(flips) : 0,
    pinnedP99: pinned.length ? quantile(pinned, 0.99) : 0,
    pinnedMax: pinned.length ? maxOf(pinned) : 0,
    pressureAmp: amp.length ? median(amp) : 0,
    cyclicShortShare: shortCycles.length ? mean(shortCycles.map((x) => (x ? 1 : 0))) : 0,
    spectralP95: peaks.length ? quantile(peaks, 0.95) : 0,
  };
}

function g10(d: LabData, base: BaselineRef | null): GateResult {
  const s = stability(d);
  const worst = (k: 'flipsP99' | 'pinnedP99', at: number) =>
    s.byMeter.filter((m) => m[k] > at).sort((a, b) => b[k] - a[k]).map((m) => `${m.meter} ${round(m[k], 1)}`).join(', ') || 'none';
  const checks: Check[] = [
    { name: 'Meter sign changes in any 30 days (p99 over town × meter)', value: round(s.flipsP99, 1), target: '≤ 6', ok: s.flipsP99 <= 6, note: `max ${s.flipsMax}; over the line: ${worst('flipsP99', 6)}. A sign needs |meter| > 5 (hysteresis); meters of zones the tier cannot build are skipped` },
    { name: 'Longest run pinned at ±100 (p99, months)', value: round(s.pinnedP99, 1), target: '≤ 30', ok: s.pinnedP99 <= 30, note: `max ${s.pinnedMax}; over the line: ${worst('pinnedP99', 30)}` },
    { name: 'Housing-pressure cycle amplitude ÷ mean (median town)', value: round(s.pressureAmp), target: '< 0.25', ok: s.pressureAmp < 0.25, note: 'pressure = (applicants + squeezed) ÷ population, after month 24' },
    { name: 'Share of cycling towns with a period ≤ 24 months', value: round(s.cyclicShortShare), target: '≤ 0.10', ok: s.cyclicShortShare <= 0.1 },
  ];
  const thr = base?.spectralThreshold ?? null;
  checks.push({
    name: 'Spectral peak of monthly growth (p95 peak ÷ mean power)',
    value: round(s.spectralP95, 2),
    target: thr === null ? 'sets the first baseline' : `≤ ${round(thr, 2)} (first baseline × 1.25)`,
    ok: thr === null ? true : s.spectralP95 <= thr,
    note: thr === null ? 'no baseline yet: this run establishes it' : undefined,
  });
  return { id: 'G10', title: 'Stability', verdict: verdictOf(checks), m0: true, checks };
}

function g11(d: LabData): GateResult {
  const debt = towns(d.mixed, 'debt');
  const all = towns(d.mixed);
  const episodes = all.flatMap((t) => helperEpisodes(t.helper, t.helperSince));
  const ended = episodes.filter(([, e]) => e);
  const long = episodes.filter(([n]) => n > 10);
  const checks: Check[] = [];
  if (debt.length) {
    const ci = shareCI(debt.map((t) => t.helper.some((h) => h > 0)), 1000, 61);
    checks.push({ name: 'Debt Spender enters Helper Mode', value: round(ci.est), target: '> 0 (reachable)', ok: ci.est > 0, ci, n: debt.length });
  }
  checks.push({ name: 'Helper Mode episodes longer than 10 days', value: long.length, target: '0', ok: long.length === 0, n: episodes.length, note: `${ended.length} ended, longest ${episodes.reduce((m, [n]) => Math.max(m, n), 0)} days` });
  // Equal skill, different rhythm: Balanced plays 21 sessions a week, Weekly 3 (same style).
  const pts: [number, number][] = [];
  for (const t of all.filter((x) => x.bot === 'balanced' || x.bot === 'weekly' || x.bot === 'hermit' || x.bot === 'cooperator')) {
    const n = t.pop.length;
    if (n < 2) continue;
    pts.push([(t.sessions / n) * 7, t.pop[n - 1] / n]);
  }
  if (pts.length >= 3) {
    const r = correlation(pts.map((p) => p[0]), pts.map((p) => p[1]));
    checks.push({ name: 'corr(sessions per week, growth), equal-skill bots', value: round(r), target: '< 0.3', ok: r < 0.3, n: pts.length, provisional: true, note: 'Balanced vs Weekly rhythms, solo towns' });
  }
  checks.push(pend('Every seat wins ≥ 1 award or Mention per 14 days', '≥ 0.95 of runs'));
  return { id: 'G11', title: 'Fair rhythm and recognition', verdict: verdictOf(checks), m0: false, checks };
}

/** §10.15 budgets (p95, Node on the VPS) and §10.8's room size. */
export const BUDGETS = { tickMs: 0.3, monthMs: 3, regionalMs: 15, chunkMs: 40, roomBytes: 320 * 1024 };

function g12(d: LabData): GateResult {
  const timed = (d.timing?.length ? d.timing : d.mixed).filter((r) => r.timings);
  const pool = (k: 'tick' | 'month' | 'regional' | 'chunk') => timed.flatMap((r) => r.timings![k]);
  const checks: Check[] = [];
  const add = (name: string, xs: number[], budget: number, unit: string) => {
    if (!xs.length) return checks.push(pend(name, `≤ ${budget} ${unit}`, 'no timed runs'));
    const p95 = quantile(xs, 0.95);
    checks.push({ name, value: round(p95, 3), target: `≤ ${budget} ${unit} p95`, ok: p95 <= budget, n: xs.length, note: `median ${round(median(xs), 3)}, max ${round(maxOf(xs), 2)}` });
  };
  add('Tick (development scan and pipeline)', pool('tick'), BUDGETS.tickMs, 'ms');
  add('Month step, including transport', pool('month'), BUDGETS.monthMs, 'ms');
  add('Regional Day, 6 towns (steps 1–10)', pool('regional'), BUDGETS.regionalMs, 'ms');
  add('Catch-up chunk (96 units)', pool('chunk'), BUDGETS.chunkMs, 'ms');
  const rooms = d.mixed.concat(d.pacing).map((r) => r.roomBytes);
  if (rooms.length) {
    const max = maxOf(rooms);
    checks.push({ name: 'Largest 6-town room measured', value: max, target: `≤ ${BUDGETS.roomBytes} bytes`, ok: max <= BUDGETS.roomBytes, n: rooms.length });
    const all = towns(d.mixed.concat(d.pacing));
    const biggest = all.reduce((a, t) => (t.bytes > a.bytes ? t : a), all[0]);
    const metro = all.filter((t) => t.tier[t.tier.length - 1] >= 4);
    const perTown = metro.length ? Math.max(...metro.map((t) => t.bytes)) : biggest.bytes;
    const overhead = Math.max(0, ...d.mixed.map((r) => r.roomBytes - r.towns.reduce((s, t) => s + t.bytes, 0)));
    const projected = perTown * 6 + overhead;
    checks.push({
      name: 'Six-metropolis room, projected',
      value: projected,
      target: `≤ ${BUDGETS.roomBytes} bytes`,
      ok: metro.length ? projected <= BUDGETS.roomBytes : projected <= BUDGETS.roomBytes ? true : null,
      provisional: !metro.length,
      note: metro.length ? `largest metropolis ${perTown} bytes × 6 + county ${overhead}` : `no metropolis yet: largest town (tier ${biggest.tier[biggest.tier.length - 1]}, pop ${biggest.pop[biggest.pop.length - 1]}) ${perTown} bytes × 6 + county ${overhead}`,
    });
  }
  return { id: 'G12', title: 'Budgets', verdict: verdictOf(checks), m0: true, checks, note: 'Timed on the Lab machine, one county at a time after the pool has drained and an untimed warm-up county, without the observer; budgets are §10.15 p95s.' };
}

export function evaluateGates(d: LabData, base: BaselineRef | null): GateResult[] {
  const gates: [string, string, boolean, () => GateResult][] = [
    ['G1', 'No dominant strategy', false, () => g1(d)],
    ['G2', 'Emergent Laffer', false, () => g2(d)],
    ['G2b', 'Tax still hurts when land runs out (A13)', false, () => g2b(d)],
    ['G13', 'Catalogue and start (A11, A14)', false, () => g13(d)],
    ['G3', 'Pacing', true, () => g3(d)],
    ['G4', 'Co-operation pays', false, () => g4()],
    ['G5', 'Specialisation', false, () => g5()],
    ['G6', 'Gentle rivalry', false, () => g6()],
    ['G7', 'No runaway', false, () => g7(d)],
    ['G8', 'Absence safety', true, () => g8(d)],
    ['G9', 'Explainability', true, () => g9(d)],
    ['G10', 'Stability', true, () => g10(d, base)],
    ['G11', 'Fair rhythm and recognition', false, () => g11(d)],
    ['G12', 'Budgets', true, () => g12(d)],
  ];
  // One gate's arithmetic failing must not lose a long run's other verdicts.
  return gates.map(([id, title, m0, f]) => {
    try {
      return f();
    } catch (e) {
      return { id, title, verdict: 'fail' as const, m0, checks: [{ name: 'evaluation', value: String(e instanceof Error ? e.message : e), target: 'no error', ok: false }] };
    }
  });
}

/** M0's exit (§13.3): G3, G8, G9, G10 and G12 green (their single-town checks). */
export function m0Verdict(gates: GateResult[]): Verdict {
  const m0 = gates.filter((g) => g.m0);
  if (m0.some((g) => g.verdict === 'fail')) return 'fail';
  if (m0.some((g) => g.verdict === 'pending')) return 'pending';
  return 'pass';
}
