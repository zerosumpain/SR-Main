// The tick and the month step (spec §5.2, §5.3, A18). A tick is atomic:
// queued moves stamped for it, then the tick steps, then — on every fourth
// tick — the month step M1–M14, then t.tick + 1. Catch-up chunks never split
// one.
//
// Both halves are guarded (§10.4 item 9: one broken town never stops the
// county). The moves and tick steps run against a copy taken at the start of
// the tick and are checked by the invariants straight away; if they throw or
// leave the town broken, the town goes back to that copy, the tick's work is
// skipped with an alert and the tick still counts. The month step does the
// same with a copy taken after the tick steps: it runs the step table with a
// fresh blackboard, checks that each step wrote only the slots it declared,
// then runs the invariant checks; on any failure the town reverts to its
// pre-month state and skips the month. Checking after the tick steps too is
// what stops a bad value written there from hiding inside the month's copy.

import { calendarMonth, countyMonth, gridEndAt, gridOfTownTick, gridTickAt, townTarget } from './clock';
import { commitTown, rollMonthBooks, settleTown } from './core';
import { SLOT_NAMES, newDerivedCache, readSlots } from './derived';
import { forgetDev } from './develop';
import { checkTown } from './invariants';
import { applyBudget, applyBuild, applyUndo, type OpsEnv } from './ops';
import { paramsFor, type Params } from './params';
import { STREAMS, h32 } from './rand';
import { forgetRecords } from './records';
import { STEPS } from './steps';
import { closeMonthPool, openMonthPool } from './pool';
import { planesSnapshot, restorePlanes, type PlanesSnapshot } from './tiles';
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

function pushAlert(t: TownState, at: number, town: number, kind: 'month-reverted' | 'tick-reverted' | 'invariant', message: string): void {
  t.alerts.push({ at, town, kind, message: message.slice(0, 400) });
  while (t.alerts.length > ALERTS_KEEP) t.alerts.shift();
}

/**
 * A copy of a town's stored data for reverting to. Strings are shared (they
 * are immutable, and the planes, history and Why are long ones), so this is
 * far cheaper than a JSON round trip, and unlike one it keeps a NaN a NaN.
 * Keys holding undefined are dropped, as JSON would.
 */
function copyData<T>(x: T): T {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) {
    const out = new Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = copyData(x[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in x as Record<string, unknown>) {
    const v = (x as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = copyData(v);
  }
  return out as T;
}

/** A town's state to revert to: its stored data, and its decoded planes (whose string may not be written yet). */
interface Saved {
  data: TownState;
  planes: PlanesSnapshot | null;
}

function save(t: TownState): Saved {
  settleTown(t);
  return { planes: planesSnapshot(t), data: copyData(t) };
}

/** Puts a saved copy back into the same object (memos keyed on the town stay valid) and drops the decoded copies. */
function restoreTown(t: TownState, saved: Saved): void {
  for (const k of Object.keys(t)) delete (t as unknown as Record<string, unknown>)[k];
  Object.assign(t, saved.data);
  restorePlanes(t, saved.planes);
  forgetRecords(t);
  forgetDev(t);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One tick of one town, plus the month step when t mod 4 = 3 (§10.3 tickTown), with the stored strings written back. */
export function tickTown(t: TownState, ctx: TickContext, steps: StepTable = STEPS): void {
  advanceTown(t, ctx, steps);
  commitTown(t);
}

/**
 * tickTown without the final commit: the catch-up driver runs many ticks
 * and commits once at the end of the chunk (the planes' encoding is most of
 * a plain tick's cost). planesRev is still counted at every tick end.
 */
export function advanceTown(t: TownState, ctx: TickContext, steps: StepTable = STEPS): void {
  if (ctx.tick !== t.tick) throw new Error(`tickTown: context is for tick ${ctx.tick}, town is at ${t.tick}`);
  const before = save(t);
  let problems: string[];
  try {
    applyPending(t, ctx);
    for (const s of steps.tick) s.run(t, ctx);
    settleTown(t);
    problems = checkTown(t);
  } catch (e) {
    problems = [message(e)];
  }
  if (problems.length) {
    restoreTown(t, before);
    // Moves queued for this tick can never land now; the log keeps their records.
    t.pending = t.pending.filter((r) => r.atTick > t.tick);
    pushAlert(t, ctx.at, ctx.townIndex, 'tick-reverted', `tick ${t.tick} skipped: ${problems.slice(0, 3).join('; ')}`);
  }
  if (t.tick % 4 === 3) pooledMonthStep(t, ctx, steps);
  t.tick += 1;
  settleTown(t);
}

/**
 * monthStep with the month's typed arrays drawn from the pool (pool.ts) and
 * handed back when it ends: nothing outside advanceTown sees this month's
 * blackboard, so its planes can be reused by the next one.
 */
function pooledMonthStep(t: TownState, ctx: TickContext, steps: StepTable): void {
  openMonthPool();
  try {
    monthStep(t, ctx, steps);
  } finally {
    closeMonthPool();
  }
}

/** The month step (§5.3) for the tick in ctx. Exposed for tests and the Lab. */
export function monthStep(t: TownState, ctx: TickContext, steps: StepTable = STEPS): void {
  const before = save(t);
  const derived: DerivedCache = newDerivedCache();
  const why = new MonthWhy();
  const m: MonthContext = { ...ctx, month: ctx.world.month, derived, why };
  let problems: string[] = [];
  const had: unknown[] = new Array(SLOT_NAMES.length).fill(null);
  const now: unknown[] = new Array(SLOT_NAMES.length).fill(null);
  try {
    for (const step of steps.month) {
      readSlots(derived, had);
      step.run(t, m);
      readSlots(derived, now);
      for (let k = 0; k < SLOT_NAMES.length; k++) {
        if (now[k] === had[k]) continue;
        const n = SLOT_NAMES[k];
        if (had[k] !== null) problems.push(`${step.id} replaced the ${n} slot another step wrote`);
        else if (!step.writes.includes(n)) problems.push(`${step.id} wrote the ${n} slot without declaring it`);
      }
      if (problems.length) break;
    }
    if (problems.length === 0) {
      settleTown(t);
      commitWhy(t, why, m.month);
      problems = checkTown(t);
    }
  } catch (e) {
    problems = [message(e)];
  }
  if (problems.length) {
    restoreTown(t, before);
    pushAlert(t, ctx.at, ctx.townIndex, 'month-reverted', `month ${m.month} skipped: ${problems.slice(0, 3).join('; ')}`);
  } else if (why.problems.length) {
    pushAlert(t, ctx.at, ctx.townIndex, 'invariant', `Why: ${why.problems.slice(0, 3).join('; ')}`);
  }
  rollMonthBooks(t);
}

/** Whether a "Play it all" sprint tick is due by `limit` (one every sprintAutoMs after the last). */
export function autoSprintDue(t: TownState, limit: number, sprintAutoMs: number): boolean {
  return t.sprintAuto && t.gridBase === null && t.sprintLeft > 0 && t.sprintAt + sprintAutoMs <= limit;
}

/** Runs one Founding Fortnight tick for town i at real instant `now` (§2.3). Joins the grid after the last. The caller commits. */
export function sprintTick(c: CountyState, i: number, now: number, steps: StepTable = STEPS): void {
  const t = c.towns[i];
  if (t.sprintLeft <= 0 || t.gridBase !== null) return;
  advanceTown(t, makeContext(c, i, t.tick, now), steps);
  t.sprintLeft -= 1;
  t.sprintAt = now;
  if (t.sprintLeft === 0) {
    // Town tick `t.tick` becomes the grid tick that starts at the next boundary.
    t.gridBase = gridTickAt(c, now) + 1 - t.tick;
    t.sprintAuto = false;
  }
}

/**
 * Unit costs of catch-up work (§10.5). A unit is meant to be one plain tick's
 * worth of CPU, so that a 96-unit chunk fits the 40 ms budget. §10.5 priced a
 * month step at 6 ticks against its 3 ms target; measured on the Metropolis
 * fixture (bundled, plain Node) a month step costs about 20 plain ticks, and
 * at 6 a chunk ran 75–150 ms. The price is a scheduling estimate only:
 * catch-up gives the same county for any budget, so changing it moves no
 * numbers, only where chunks end.
 */
export const COST_TICK = 1;
export const COST_MONTH = 20;
export const COST_YEAR_END = 8;
export const COST_REGIONAL_DAY = 20;

export const tickCost = (t: TownState): number => COST_TICK + (t.tick % 4 === 3 ? COST_MONTH : 0);

/** Catches one town up to `gridTicks` completed grid ticks, unbounded. Returns ticks run. */
export function catchUpTown(c: CountyState, i: number, gridTicks: number, steps: StepTable = STEPS): number {
  const t = c.towns[i];
  let n = 0;
  while (t.tick < townTarget(t, gridTicks)) {
    advanceTown(t, makeContext(c, i, t.tick), steps);
    n++;
  }
  commitTown(t);
  return n;
}
