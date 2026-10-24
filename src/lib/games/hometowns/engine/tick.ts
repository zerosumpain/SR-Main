// The tick and the month step (spec §5.2, §5.3, A18). A tick is atomic:
// queued moves stamped for it, then the tick steps, then — on every fourth
// tick — the month step M1–M14, then t.tick + 1. Catch-up chunks never split
// one. The month step runs the step table with a fresh blackboard, checks
// that each step wrote only the slots it declared, then runs the invariant
// checks; if anything fails (or throws), the town reverts to its pre-month
// state, skips the month and records an alert (§10.4 item 9).

import { calendarMonth, countyMonth, gridEndAt, gridOfTownTick, gridTickAt, townTarget } from './clock';
import { commitTown, rollMonthBooks } from './core';
import { SLOT_NAMES, newDerivedCache } from './derived';
import { checkTown } from './invariants';
import { applyBudget, applyBuild, applyUndo, type OpsEnv } from './ops';
import { paramsFor, type Params } from './params';
import { STREAMS, h32 } from './rand';
import { forgetRecords } from './records';
import { STEPS } from './steps';
import { forgetPlanes } from './tiles';
import type { CountyState, DerivedCache, MonthContext, Snapshot, StepTable, TickContext, TownState } from './types';
import { MonthWhy, commitWhy } from './why';
import { worldAt } from './world';

export const ALERTS_KEEP = 10;

export interface TownEnv {
  params: Params;
  snapshot: Snapshot;
  rivalry: 'friendly' | 'spirited';
  mishaps: 'mild' | 'off';
  dayIndex: number;
}

/**
 * The context for tick `tick` of a town from its own fields and the snapshot
 * alone: what the server, a phone predicting, and a forecast all build.
 * `at` is the tick's grid end instant (sprint ticks: the real instant).
 */
export function townContext(t: TownState, i: number, tick: number, env: TownEnv, at: number, sprint: boolean, seed = t.seed): TickContext {
  const g = gridOfTownTick(t, tick);
  const month = countyMonth(g);
  const snap = env.snapshot;
  return {
    params: env.params,
    snapshot: snap,
    world: worldAt(snap.worldSeed, month, { startMonth: snap.season.startMonth, boomBust: snap.season.boomBust }, env.params),
    seed,
    townIndex: i,
    tick,
    at,
    calendarMonth: calendarMonth(at),
    rivalry: env.rivalry,
    mishaps: env.mishaps,
    sprint,
    dayIndex: env.dayIndex,
    rng: (stream, a, b) => h32(seed, STREAMS[stream], a, b, tick),
  };
}

/** The context for running tick `tick` of town `i` (sprint ticks pass the real instant). */
export function makeContext(c: CountyState, i: number, tick: number, sprintAt: number | null = null): TickContext {
  const t = c.towns[i];
  const env: TownEnv = { params: paramsFor(c.paramsVersion), snapshot: c.snapshot, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, dayIndex: c.dayIndex };
  const at = sprintAt ?? gridEndAt(c, gridOfTownTick(t, tick));
  return townContext(t, i, tick, env, at, sprintAt !== null);
}

/** Applies moves queued for exactly this tick (A19), in their recorded order. */
function applyPending(t: TownState, ctx: TickContext): void {
  if (t.pending.length === 0) return;
  const due = t.pending.filter((r) => r.atTick === t.tick);
  if (due.length === 0) return;
  t.pending = t.pending.filter((r) => r.atTick !== t.tick);
  const env: OpsEnv = { params: ctx.params, dayIndex: ctx.dayIndex, profile: 'adult' };
  for (const r of due) {
    try {
      const cmd = r.cmd;
      if (cmd.type === 'build') applyBuild(t, cmd.planId, cmd.plan, env);
      else if (cmd.type === 'undo') applyUndo(t, cmd.planId, env);
      else if (cmd.type === 'budget') applyBudget(t, cmd.taxes, cmd.funding, env);
    } catch {
      // A queued move that no longer fits is dropped; the log keeps its record.
    }
  }
}

function pushAlert(t: TownState, at: number, town: number, kind: 'month-reverted' | 'invariant', message: string): void {
  t.alerts.push({ at, town, kind, message: message.slice(0, 400) });
  while (t.alerts.length > ALERTS_KEEP) t.alerts.shift();
}

/** One tick of one town, plus the month step when t mod 4 = 3 (§10.3 tickTown). */
export function tickTown(t: TownState, ctx: TickContext, steps: StepTable = STEPS): void {
  if (ctx.tick !== t.tick) throw new Error(`tickTown: context is for tick ${ctx.tick}, town is at ${t.tick}`);
  applyPending(t, ctx);
  for (const s of steps.tick) s.run(t, ctx);
  if (t.tick % 4 === 3) monthStep(t, ctx, steps);
  t.tick += 1;
  commitTown(t);
}

/** The month step (§5.3) for the tick in ctx. Exposed for tests and the Lab. */
export function monthStep(t: TownState, ctx: TickContext, steps: StepTable = STEPS): void {
  commitTown(t);
  const before = JSON.stringify(t);
  const derived: DerivedCache = newDerivedCache();
  const why = new MonthWhy();
  const m: MonthContext = { ...ctx, month: ctx.world.month, derived, why };
  let problems: string[] = [];
  try {
    for (const step of steps.month) {
      const had = SLOT_NAMES.map((n) => derived[n]);
      step.run(t, m);
      SLOT_NAMES.forEach((n, k) => {
        const now = derived[n];
        if (now === had[k]) return;
        if (had[k] !== null) problems.push(`${step.id} replaced the ${n} slot another step wrote`);
        else if (!step.writes.includes(n)) problems.push(`${step.id} wrote the ${n} slot without declaring it`);
      });
      if (problems.length) break;
    }
    if (problems.length === 0) {
      commitTown(t);
      commitWhy(t, why, m.month);
      problems = checkTown(t);
    }
  } catch (e) {
    problems = [`${e instanceof Error ? e.message : String(e)}`];
  }
  if (problems.length) {
    const saved = JSON.parse(before) as TownState;
    for (const k of Object.keys(t)) delete (t as unknown as Record<string, unknown>)[k];
    Object.assign(t, saved);
    forgetPlanes(t);
    forgetRecords(t);
    pushAlert(t, ctx.at, ctx.townIndex, 'month-reverted', `month ${m.month} skipped: ${problems.slice(0, 3).join('; ')}`);
  } else if (why.problems.length) {
    pushAlert(t, ctx.at, ctx.townIndex, 'invariant', `Why: ${why.problems.slice(0, 3).join('; ')}`);
  }
  rollMonthBooks(t);
}

/** Runs one Founding Fortnight tick for town i at real instant `now` (§2.3). Joins the grid after the last. */
export function sprintTick(c: CountyState, i: number, now: number, steps: StepTable = STEPS): void {
  const t = c.towns[i];
  if (t.sprintLeft <= 0 || t.gridBase !== null) return;
  tickTown(t, makeContext(c, i, t.tick, now), steps);
  t.sprintLeft -= 1;
  t.sprintAt = now;
  if (t.sprintLeft === 0) {
    // Town tick `t.tick` becomes the grid tick that starts at the next boundary.
    t.gridBase = gridTickAt(c, now) + 1 - t.tick;
    t.sprintAuto = false;
  }
}

/** Unit costs of catch-up work (§10.5). */
export const COST_TICK = 1;
export const COST_MONTH = 6;
export const COST_YEAR_END = 8;
export const COST_REGIONAL_DAY = 20;

export const tickCost = (t: TownState): number => COST_TICK + (t.tick % 4 === 3 ? COST_MONTH : 0);

/** Catches one town up to `gridTicks` completed grid ticks, unbounded. Returns ticks run. */
export function catchUpTown(c: CountyState, i: number, gridTicks: number, steps: StepTable = STEPS): number {
  const t = c.towns[i];
  let n = 0;
  while (t.tick < townTarget(t, gridTicks)) {
    tickTown(t, makeContext(c, i, t.tick), steps);
    n++;
  }
  return n;
}
