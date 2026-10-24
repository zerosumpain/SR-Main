// Watching the engine from outside (spec §11.4 G9, G10, G12). The Observer
// builds a step table whose rows call the real steps unchanged and, around
// them, take notes: every Why term each month step adds (so G9 can compare
// the top three with ALL terms, not just the stored residual), the meters
// and population at each month end (G10), and how long ticks, month steps
// and Regional Days take (G12). It never writes to the town, so a county
// run with observers has the same hash as one without; observe.test.ts
// holds it to that.

import { STEPS, withSteps } from '../../../src/lib/games/hometowns/engine/steps';
import { TERMS } from '../../../src/lib/games/hometowns/engine/why';
import { population } from '../../../src/lib/games/hometowns/engine/core';
import { REVENUE_LINES } from '../../../src/lib/games/hometowns/engine/finance';
import { LEDGER_LINES } from '../../../src/lib/games/hometowns/engine/types';
import type { MonthContext, MonthStep, RegionalStep, StepTable, TickContext, TickStep, TownState, WhyWriter } from '../../../src/lib/games/hometowns/engine/types';

export interface TownMonthly {
  months: number;
  /** Per month: the 8 meters (METER order), rounded to 0.1. */
  meters: number[][];
  /** Population at each month end. */
  pop: number[];
  /** Housing pressure at each month end: (applicants + squeezed) ÷ population. */
  pressure: number[];
  /** Per month with any term: the top-3 share of Σ|terms| for population and revenue (−1: no terms that month). */
  whyPop: number[];
  whyRev: number[];
  /** Tier at each month end (G10 ignores meters of zones a tier cannot build). */
  tier?: number[];
  /** £ per resident this month: recurring revenue and running upkeep (§5.13's calibration table, G13). */
  revPer?: number[];
  upkeepPer?: number[];
}

/** The upkeep side of §5.13's table: running costs of services, roads and utilities, not debt or capital. */
const UPKEEP_LINES = ['upkeepCivic', 'upkeepRoads', 'upkeepUtilities', 'utilityImports', 'policyCosts', 'repairs'].map((l) => LEDGER_LINES.indexOf(l as never));
const REVENUE_INDEX = REVENUE_LINES.map((l) => LEDGER_LINES.indexOf(l));

const TERM_Q: Record<string, string> = {};
for (const d of TERMS) TERM_Q[d.key] = d.q;

/** The quantity a term lands on, as why.ts's MonthWhy resolves it. */
function quantityOf(key: string, amount: number, quantity?: string): string | null {
  if (quantity) return quantity;
  if (key.startsWith('money.')) return amount >= 0 ? 'revenue' : 'spending';
  const q = TERM_Q[key];
  return q && !q.includes('*') ? q : null;
}

/** Top-3 |term| share of Σ|terms| after summing per key: what three Why lines explain of the gross movement. */
export function top3Share(sums: Map<string, number>): number {
  const a = [...sums.values()].map(Math.abs).sort((x, y) => y - x);
  const all = a.reduce((s, x) => s + x, 0);
  if (all <= 0) return -1;
  return (a[0] + (a[1] ?? 0) + (a[2] ?? 0)) / all;
}

const FIRST_MONTH = STEPS.month[0].id;
const LAST_MONTH = STEPS.month[STEPS.month.length - 1].id;
const FIRST_TICK = STEPS.tick[0].id;
const LAST_TICK = STEPS.tick[STEPS.tick.length - 1].id;
const FIRST_REGIONAL = STEPS.regional[0].id;
const LAST_REGIONAL = STEPS.regional[STEPS.regional.length - 1].id;

interface Pending {
  pop: Map<string, number>;
  rev: Map<string, number>;
  t0: number;
}

export class Observer {
  private readonly towns: TownMonthly[] = [];
  private readonly pending = new Map<number, Pending>();
  private tickStart = 0;
  private dayStart = 0;
  private readonly samples = { tick: [] as number[], month: [] as number[], regional: [] as number[], chunk: [] as number[] };

  constructor(
    readonly notes: boolean,
    readonly timing: boolean,
  ) {}

  town(i: number): TownMonthly {
    return this.towns[i] ?? { months: 0, meters: [], pop: [], pressure: [], whyPop: [], whyRev: [], tier: [] };
  }

  chunk(ms: number): void {
    push(this.samples.chunk, ms);
  }

  timings(): { tick: number[]; month: number[]; regional: number[]; chunk: number[] } {
    return { tick: [...this.samples.tick], month: [...this.samples.month], regional: [...this.samples.regional], chunk: [...this.samples.chunk] };
  }

  /** Snapshot of the notes so far (a fork restarts each arm from the same notes). */
  save(): string {
    return JSON.stringify({ towns: this.towns, samples: this.samples });
  }

  restore(s: string): void {
    const o = JSON.parse(s) as { towns: TownMonthly[]; samples: Observer['samples'] };
    this.towns.length = 0;
    this.towns.push(...o.towns);
    for (const k of Object.keys(this.samples) as (keyof Observer['samples'])[]) this.samples[k] = o.samples[k];
  }

  /** The observed table: `base` (default STEPS) with its first and last rows wrapped. */
  table(base: StepTable = STEPS): StepTable {
    const find = <T extends { id: string; run: unknown }>(rows: T[], id: string) => rows.find((r) => r.id === id)!.run;
    const firstMonth = find(base.month, FIRST_MONTH) as MonthStep;
    const lastMonth = find(base.month, LAST_MONTH) as MonthStep;
    const firstTick = find(base.tick, FIRST_TICK) as TickStep;
    const lastTick = find(base.tick, LAST_TICK) as TickStep;
    const firstDay = find(base.regional, FIRST_REGIONAL) as RegionalStep;
    const lastDay = find(base.regional, LAST_REGIONAL) as RegionalStep;
    const over: Record<string, unknown> = {
      [FIRST_MONTH]: (t: TownState, m: MonthContext) => {
        this.beginMonth(m);
        firstMonth(t, m);
      },
      [LAST_MONTH]: (t: TownState, m: MonthContext) => {
        lastMonth(t, m);
        this.endMonth(t, m);
      },
      [FIRST_TICK]: (t: TownState, ctx: TickContext) => {
        if (this.timing) this.tickStart = performance.now();
        firstTick(t, ctx);
      },
      [LAST_TICK]: (t: TownState, ctx: TickContext) => {
        lastTick(t, ctx);
        if (this.timing) push(this.samples.tick, performance.now() - this.tickStart);
      },
      [FIRST_REGIONAL]: (c: Parameters<RegionalStep>[0], r: Parameters<RegionalStep>[1]) => {
        if (this.timing) this.dayStart = performance.now();
        firstDay(c, r);
      },
      [LAST_REGIONAL]: (c: Parameters<RegionalStep>[0], r: Parameters<RegionalStep>[1]) => {
        lastDay(c, r);
        if (this.timing) push(this.samples.regional, performance.now() - this.dayStart);
      },
    };
    const wrapped = withSteps(over as Parameters<typeof withSteps>[0]);
    // withSteps starts from STEPS; carry over the base table's other rows.
    const pick = <T extends { id: string }>(rows: T[], from: T[]) => rows.map((r) => (over[r.id] ? r : from.find((f) => f.id === r.id)!));
    return { tick: pick(wrapped.tick, base.tick), month: pick(wrapped.month, base.month), regional: pick(wrapped.regional, base.regional) };
  }

  private beginMonth(m: MonthContext): void {
    const p: Pending = { pop: new Map(), rev: new Map(), t0: this.timing ? performance.now() : 0 };
    this.pending.set(m.townIndex, p);
    if (!this.notes) return;
    const inner: WhyWriter = m.why;
    m.why = {
      add(key: string, amount: number, quantity?: string) {
        if (Number.isFinite(amount) && amount !== 0) {
          const q = quantityOf(key, amount, quantity);
          if (q === 'pop') p.pop.set(key, (p.pop.get(key) ?? 0) + amount);
          else if (q === 'revenue') p.rev.set(key, (p.rev.get(key) ?? 0) + amount);
        }
        inner.add(key, amount, quantity);
      },
      set(quantity: string, v: number) {
        inner.set(quantity, v);
      },
    };
  }

  private endMonth(t: TownState, m: MonthContext): void {
    const p = this.pending.get(m.townIndex);
    this.pending.delete(m.townIndex);
    if (this.timing && p) push(this.samples.month, performance.now() - p.t0);
    if (!this.notes) return;
    let o = this.towns[m.townIndex];
    if (!o) o = this.towns[m.townIndex] = { months: 0, meters: [], pop: [], pressure: [], whyPop: [], whyRev: [], tier: [], revPer: [], upkeepPer: [] };
    const pop = population(t);
    let waiting = t.squeezed;
    for (const a of t.applicants) waiting += a;
    o.months++;
    o.meters.push(t.meters.map((x) => Math.round(x * 10) / 10));
    o.pop.push(pop);
    o.pressure.push(Math.round((waiting / Math.max(1, pop)) * 10000) / 10000);
    o.whyPop.push(p ? round3(top3Share(p.pop)) : -1);
    o.whyRev.push(p ? round3(top3Share(p.rev)) : -1);
    o.tier!.push(t.tier);
    let rev = 0;
    let up = 0;
    for (const k of REVENUE_INDEX) rev += t.books.lines[k];
    for (const k of UPKEEP_LINES) up -= t.books.lines[k];
    const n = Math.max(1, pop);
    (o.revPer ??= []).push(Math.round((rev / n) * 10) / 10);
    (o.upkeepPer ??= []).push(Math.round((up / n) * 10) / 10);
  }
}

const round3 = (x: number) => (x < 0 ? -1 : Math.round(x * 1000) / 1000);

/** Keeps the first 20,000 samples of a series: a 60-day county of six towns makes about 17,000 ticks. */
function push(a: number[], v: number): void {
  if (a.length < 20_000) a.push(v);
}
