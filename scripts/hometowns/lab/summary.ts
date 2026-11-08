// Per-bot summaries and the scorecard shape (the report JSON schema, spec
// §13.2 WP5 interfaces). The scorecard is what the HTML report renders, what
// baselines store a slice of, and what a balance PR attaches.

import type { BotId } from '../../../src/lib/games/hometowns/engine/bots';
import type { CountyResult, TownSummary } from './run';
import { composite, drawdown, m0Verdict, stability, type GateResult, type LabData, type Verdict } from './gates';
import { bootstrap, mean, median, quantile, round, type CI } from './stats';
import type { PlanConfig } from './experiments';

export interface BotRow {
  bot: BotId;
  n: number;
  finalPop: CI;
  happy: number;
  /** Median Regional Day to Village, Town, City, Metropolis (null: median not reached). */
  tierDays: (number | null)[];
  /** Share of towns that reached each tier by the end. */
  tierShare: number[];
  helperDays: number;
  composite: number;
  drawdown: number;
  sessions: number;
  refusals: [string, number][];
  /** Median Balanced-style population by day (for the sparkline). */
  popByDay: number[];
}

export interface Scorecard {
  schema: 1;
  createdAt: string;
  profile: string;
  config: PlanConfig;
  engineHash: string;
  paramsHash: string;
  variant: string | null;
  wallMs: number;
  workers: number;
  townDays: number;
  verdict: Verdict;
  m0: Verdict;
  gates: GateResult[];
  bots: BotRow[];
  stability: ReturnType<typeof stability>;
  alerts: { reverted: number; refusedErrors: number };
  ab?: AbReport;
  sweep?: SweepReport;
  offRule?: OffRuleReport;
  regressions?: string[];
}

export interface AbMetric {
  name: string;
  base: number;
  variant: number;
  /** Paired mean difference (variant − base) with its 95% CI. */
  diff: CI;
  rel: number;
}

export interface AbReport {
  variant: string;
  overrides: Record<string, unknown>;
  pairs: number;
  metrics: AbMetric[];
  gates: { id: string; base: Verdict; variant: Verdict }[];
}

export interface SweepRow {
  path: string;
  /** Relative change of each outcome at ×0.8 and ×1.2. */
  down: Record<string, number>;
  up: Record<string, number>;
  fragile: boolean;
  dead: boolean;
}

export interface SweepReport {
  seeds: number;
  days: number;
  outcomes: string[];
  base: Record<string, number>;
  rows: SweepRow[];
}

export interface OffRuleRow {
  system: string;
  status: 'identical' | 'pass' | 'fail' | 'pending';
  /** Where the two runs first differ, if they do. */
  firstDivergence: string | null;
  note: string;
}

export interface OffRuleReport {
  rows: OffRuleRow[];
}

const last = (xs: number[]) => xs[xs.length - 1] ?? 0;

export function botRows(results: CountyResult[]): BotRow[] {
  const by = new Map<BotId, TownSummary[]>();
  for (const r of results) for (const t of r.towns) {
    if (!by.has(t.bot)) by.set(t.bot, []);
    by.get(t.bot)!.push(t);
  }
  const rows: BotRow[] = [];
  for (const [bot, ts] of by) {
    const finals = ts.map((t) => last(t.pop));
    const refusals = new Map<string, number>();
    for (const t of ts) for (const [k, v] of Object.entries(t.refused)) refusals.set(k, (refusals.get(k) ?? 0) + v);
    const days = Math.max(...ts.map((t) => t.pop.length));
    const popByDay: number[] = [];
    for (let d = 0; d < days; d++) popByDay.push(median(ts.filter((t) => t.pop.length > d).map((t) => t.pop[d])));
    rows.push({
      bot,
      n: ts.length,
      finalPop: bootstrap(finals, median, 500, 7),
      happy: round(median(ts.map((t) => last(t.happy))), 1),
      tierDays: [1, 2, 3, 4].map((k) => {
        const m = median(ts.map((t) => t.tierDay[k - 1] ?? Infinity));
        return Number.isFinite(m) ? round(m, 1) : null;
      }),
      tierShare: [1, 2, 3, 4].map((k) => round(mean(ts.map((t) => (last(t.tier) >= k ? 1 : 0))), 2)),
      helperDays: round(mean(ts.map((t) => t.helper.reduce((s, h) => s + h, 0))), 2),
      composite: round(mean(ts.map(composite)), 0),
      drawdown: round(quantile(ts.map((t) => drawdown(t.pop)), 0.9), 3),
      sessions: round(mean(ts.map((t) => t.sessions)), 1),
      refusals: [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 5),
      popByDay,
    });
  }
  const order = ['balanced', 'tourist', 'industrial', 'suburb', 'greedy', 'debt', 'poacher', 'hermit', 'cooperator', 'kid', 'weekly', 'absent', 'spammer'];
  return rows.sort((a, b) => order.indexOf(a.bot) - order.indexOf(b.bot));
}

export function overall(gates: GateResult[]): Verdict {
  if (gates.some((g) => g.verdict === 'fail')) return 'fail';
  if (gates.some((g) => g.verdict === 'pending')) return 'pending';
  return 'pass';
}

export function scorecardOf(o: {
  profile: string;
  config: PlanConfig;
  engineHash: string;
  paramsHash: string;
  variant: string | null;
  wallMs: number;
  workers: number;
  data: LabData;
  gates: GateResult[];
}): Scorecard {
  const all = o.data.mixed.concat(o.data.g2b, o.data.pacing);
  const ts = all.flatMap((r) => r.towns);
  let refusedErrors = 0;
  for (const t of ts) for (const [k, v] of Object.entries(t.refused)) if (k.includes(': error:')) refusedErrors += v;
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    profile: o.profile,
    config: o.config,
    engineHash: o.engineHash,
    paramsHash: o.paramsHash,
    variant: o.variant,
    wallMs: Math.round(o.wallMs),
    workers: o.workers,
    townDays: ts.reduce((s, t) => s + t.pop.length, 0),
    verdict: overall(o.gates),
    m0: m0Verdict(o.gates),
    gates: o.gates,
    bots: botRows(o.data.mixed),
    stability: stability(o.data),
    alerts: { reverted: ts.reduce((s, t) => s + t.reverted, 0), refusedErrors },
  };
}
