// One Lab county, start to finish (spec §11.1, §11.3): create a county,
// found a town per seat with its bot, play the Founding Fortnight, then live
// `days` Regional Days on the production clock with every bot playing its
// sessions through applyCommand, exactly as phones would. While it runs it
// watches the engine from the outside, through a step table whose rows wrap
// the real steps without touching state (observe.ts), and at the end it
// returns compact per-town summaries: everything the gates need, small
// enough to come back from a worker thread.
//
// A run is a pure function of its spec: the same spec gives the same county
// hash on any machine, in any worker, in any order.

import { botById, brambleCommands, viewOf, type BotDef, type BotId, type Style } from '../../../src/lib/games/hometowns/engine/bots';
import { stylePolicy } from '../../../src/lib/games/hometowns/engine/bots/mayors';
import { londonDay, nextRegionalDayAt, weekday } from '../../../src/lib/games/hometowns/engine/clock';
import { applyCommand } from '../../../src/lib/games/hometowns/engine/commands';
import { population } from '../../../src/lib/games/hometowns/engine/core';
import { catchUp, createCounty } from '../../../src/lib/games/hometowns/engine/county';
import { countyHash } from '../../../src/lib/games/hometowns/engine/index';
import { paramsFor } from '../../../src/lib/games/hometowns/engine/params';
import { h32 } from '../../../src/lib/games/hometowns/engine/rand';
import { cohortsOf } from '../../../src/lib/games/hometowns/engine/snapshot';
import { EngineError, type Command, type CountyState, type StepTable, type TownState } from '../../../src/lib/games/hometowns/engine/types';
import { zoneCounts, mapOf } from '../../../src/lib/games/hometowns/engine/bots/planner';
import { Observer, type TownMonthly } from './observe';

/** Tuesday 20 October 2026, 12:00 UTC: every Lab county's epoch (the fixtures' too). */
export const LAB_EPOCH = 1792497600000;
const HOUR = 3_600_000;

/** A Lab-only stream number for the bots' rng: far from the engine's STREAMS, so no engine draw can collide. */
const BOT_STREAM = 0x4c4142;

export interface ForkArm {
  label: string;
  /** Style overrides applied to every seat from the fork onward (e.g. a fixed homes tax). */
  style: Partial<Style>;
}

export interface CountySpec {
  /** A label for reports ("mixedA", "g2b", …). */
  experiment: string;
  seed: number;
  /** Bot per seat; seat i founds on site i. */
  bots: (BotId | string)[];
  days: number;
  rivalry?: 'friendly' | 'spirited';
  /** Bots never open new parcels (land-limited towns for G2b). */
  noParcels?: boolean;
  /** Style overrides per seat for the whole run. */
  style?: Partial<Style>[];
  /** Run to `atDay`, then continue one copy per arm (paired A/B within one run, G2b). */
  fork?: { atDay: number; arms: ForkArm[] };
  /** Collect timing samples (G12). */
  timings?: boolean;
  /** Collect Why coverage and monthly series (G9, G10). Default true. */
  observe?: boolean;
  /** Steps to override (off-rule identity runs); the Lab's observers wrap these. */
  steps?: StepTable;
  /** The params variant this spec runs under (the worker applies it; recorded only). */
  variant?: string;
  /** In-process only: called after each Regional Day (inspection, tests). */
  onDay?: (c: CountyState, day: number) => void;
}

export interface TownSummary {
  bot: BotId;
  seat: string;
  site: number;
  siteKind: string;
  /** Per Regional Day after founding (index 0 = the first). */
  pop: number[];
  tier: number[];
  happy: number[];
  approval: number[];
  reserves: number[];
  helper: number[];
  /** The day each sampled Helper Mode episode began (−1: not in one), so back-to-back episodes stay apart. */
  helperSince: number[];
  /** Day (1-based Regional Day count) each tier 1–4 was first reached, or null. */
  tierDay: (number | null)[];
  /** Sessions and actions the bot played, and refusals by sentence. */
  sessions: number;
  commands: number;
  refused: Record<string, number>;
  /** Months the engine reverted (NaN guard) and other alerts. */
  reverted: number;
  /** Free lots left at the end (G2b's land-limited test). */
  freeLots: number;
  parcelsOpen: number;
  /** Final JSON size of the town (bytes), for the room budget. */
  bytes: number;
  monthly: TownMonthly;
}

export interface CountyResult {
  spec: Omit<CountySpec, 'steps' | 'onDay'>;
  arm: string | null;
  towns: TownSummary[];
  hash: string;
  roomBytes: number;
  wallMs: number;
  timings: { tick: number[]; month: number[]; regional: number[]; chunk: number[] } | null;
}

/** The bot rng: counter-based, keyed by (seed, seat, session instant). */
function botRng(seed: number, seat: number, at: number): () => number {
  let k = 0;
  const hi = Math.floor(at / 1000) | 0;
  return () => h32(seed, BOT_STREAM, seat, hi, k++) / 4294967296;
}

function sessionInstants(bot: BotDef, prevR: number, R: number, after: number): number[] {
  const out: number[] = [];
  for (const h of bot.sessions.hours) {
    const at = h >= 18 ? prevR + (h - 18) * HOUR : R - (18 - h) * HOUR;
    if (at <= after || at >= R) continue;
    if (bot.sessions.sundaysOnly && weekday(londonDay(at)) !== 0) continue;
    out.push(Math.round(at));
  }
  return out;
}

interface Seat {
  bot: BotDef;
  style: Style;
  summary: TownSummary;
  actionsToday: number;
}

function applyAll(c: CountyState, seatIdx: number, s: Seat, cmds: Command[], at: number): void {
  let k = 0;
  for (const cmd of cmds) {
    k++;
    s.summary.commands++;
    try {
      applyCommand(c, `s${seatIdx}`, cmd, at + k * 1000);
    } catch (e) {
      const msg = e instanceof EngineError ? e.message : `error: ${e instanceof Error ? e.message : String(e)}`;
      const key = `${cmd.type}: ${msg.replace(/£[\d,.]+[km]?/g, '£…').replace(/\d+/g, 'N').slice(0, 90)}`;
      s.summary.refused[key] = (s.summary.refused[key] ?? 0) + 1;
    }
  }
}

function session(c: CountyState, i: number, s: Seat, at: number, rngSeed: number, actions?: number): void {
  const view = viewOf(c, `s${i}`, at);
  if (!view) return;
  s.summary.sessions++;
  applyAll(c, i, s, [{ type: 'hello' }], at);
  let cmds = stylePolicy(s.bot.id, s.style)(view, botRng(rngSeed, i, at));
  if (actions !== undefined) cmds = cmds.slice(0, actions);
  applyAll(c, i, s, cmds, at + 1000);
}

function emptySummary(bot: BotDef, i: number, t: TownState): TownSummary {
  return {
    bot: bot.id,
    seat: `s${i}`,
    site: t.site,
    siteKind: t.siteKind,
    pop: [],
    tier: [],
    happy: [],
    approval: [],
    reserves: [],
    helper: [],
    helperSince: [],
    tierDay: [null, null, null, null],
    sessions: 0,
    commands: 0,
    refused: {},
    reverted: 0,
    freeLots: 0,
    parcelsOpen: 0,
    bytes: 0,
    monthly: { months: 0, meters: [], pop: [], pressure: [], whyPop: [], whyRev: [] },
  };
}

function meanHappy(t: TownState): number {
  const co = cohortsOf(t);
  let n = 0;
  let s = 0;
  for (let k = 0; k < co.length; k++) {
    n += co[k];
    s += co[k] * (t.happy[k] ?? 0);
  }
  return n > 0 ? s / n : 0;
}

function sampleDay(c: CountyState, seats: Seat[], day: number): void {
  seats.forEach((s, i) => {
    const t = c.towns[i];
    const sm = s.summary;
    sm.pop.push(population(t));
    sm.tier.push(t.tier);
    sm.happy.push(Math.round(meanHappy(t) * 100) / 100);
    sm.approval.push(Math.round(t.approval * 100) / 100);
    sm.reserves.push(Math.round(t.money.reserves));
    sm.helper.push(t.money.helper ? 1 : 0);
    sm.helperSince.push(t.money.helper ? t.money.helper.sinceDay : -1);
    for (let k = 1; k <= 4; k++) if (t.tier >= k && sm.tierDay[k - 1] === null) sm.tierDay[k - 1] = day;
  });
}

function finishSummaries(c: CountyState, seats: Seat[], obs: Observer | null): void {
  seats.forEach((s, i) => {
    const t = c.towns[i];
    const m = mapOf(t);
    s.summary.freeLots = zoneCounts(m).freeLots;
    let n = 0;
    for (let q = 0; q < 16; q++) if ((t.parcels >> q) & 1) n++;
    s.summary.parcelsOpen = n;
    s.summary.reverted = t.alerts.filter((a) => a.kind === 'month-reverted').length;
    s.summary.bytes = JSON.stringify(t).length;
    if (obs) s.summary.monthly = obs.town(i);
  });
}

/** Catches the county up to `at` in 96-unit chunks (the server's budget), timing each chunk. */
function advance(c: CountyState, at: number, steps: StepTable, obs: Observer | null): void {
  for (;;) {
    const a = obs?.timing ? performance.now() : 0;
    const r = catchUp(c, at, 96, { steps });
    if (obs?.timing && r.used > 0) obs.chunk(performance.now() - a);
    if (r.done) return;
  }
}

/** Runs a county spec. With a fork, returns one result per arm (sharing the run up to the fork). */
export function runCounty(spec: CountySpec): CountyResult[] {
  const t0 = performance.now();
  const p = paramsFor('v1');
  const bots = spec.bots.map((b) => botById(b));
  const perSeat: Record<string, { profile: 'kid' | 'adult'; pushes: boolean; pranks: boolean; answerOnly: boolean; assist: 'none' }> = {};
  bots.forEach((b, i) => (perSeat[`s${i}`] = { profile: b.profile, pushes: false, pranks: false, answerOnly: false, assist: 'none' }));
  const c = createCounty({
    seed: spec.seed,
    params: 'v1',
    settings: { rivalry: spec.rivalry ?? 'friendly', mishaps: 'mild', youngestOrder: [], perSeat },
    epoch: LAB_EPOCH,
    now: LAB_EPOCH,
  });
  const obs = spec.observe === false && !spec.timings ? null : new Observer(spec.observe !== false, !!spec.timings);
  const steps = obs ? obs.table(spec.steps) : (spec.steps ?? undefined);
  const table = steps as StepTable;
  const seats: Seat[] = [];
  // Founding is an evening around the table (§1.5): an hour after day 0's Regional Day, so day 1 is the next evening.
  const foundAt = nextRegionalDayAt(c, p.clock.devRegionalTicks) + HOUR;
  catchUp(c, foundAt, Infinity);
  bots.forEach((bot, i) => {
    const seat = `s${i}`;
    applyCommand(c, seat, { type: 'found', site: i, nameParts: ['Sunny', 'vale'], avatar: 'badger', flag: i }, foundAt + i * 1000);
    let style = bot.style;
    if (spec.style?.[i]) style = { ...style, ...spec.style[i] };
    if (spec.noParcels) style = { ...style, noParcels: true } as Style;
    const s: Seat = { bot, style, summary: emptySummary(bot, i, c.towns[i]), actionsToday: 0 };
    seats.push(s);
    applyAll(c, i, s, brambleCommands(viewOf(c, seat, foundAt + i * 1000)!), foundAt + i * 1000 + 500);
  });
  // The Founding Fortnight: twelve taps, ten seconds apart; bots that play during it act after taps 4
  // and 8, four actions each time. The evening is the founding day's play, so a bot with a daily
  // allowance (the Kid's three) spends it here.
  let at = foundAt + 60_000;
  const evening = seats.map((s) => s.bot.sessions.perDay ?? Infinity);
  for (let k = 0; k < p.clock.sprintTicks; k++) {
    at += 10_000;
    seats.forEach((s, i) => applyAll(c, i, s, [{ type: 'sprint', moveId: `tap-${k}` }], at + i * 100));
    if (k === 3 || k === 7)
      seats.forEach((s, i) => {
        const n = Math.min(4, evening[i]);
        if (!s.bot.sprintPlay || n <= 0) return;
        evening[i] -= n;
        session(c, i, s, at + 2000 + i * 100, spec.seed, n);
      });
  }
  let now = at + 10_000;

  const runDays = (from: number, to: number, cc: CountyState, ss: Seat[], tbl: StepTable) => {
    for (let d = from; d < to; d++) {
      const R = nextRegionalDayAt(cc, p.clock.devRegionalTicks);
      const prevR = cc.lastRegionalDayAt > 0 ? cc.lastRegionalDayAt : foundAt;
      const events: [number, number][] = [];
      ss.forEach((s, i) => {
        if (s.bot.sessions.hours.length === 0) return;
        for (const t of sessionInstants(s.bot, prevR, R, now)) events.push([t, i]);
        s.actionsToday = 0;
      });
      events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [t, i] of events) {
        advance(cc, t, tbl, obs);
        const s = ss[i];
        const per = s.bot.sessions.perDay;
        const actions = per !== undefined ? Math.max(0, per - s.actionsToday) : undefined;
        if (actions === 0) continue;
        session(cc, i, s, t, spec.seed, actions);
        s.actionsToday += actions ?? s.bot.sessions.actions;
        now = t + 60_000;
      }
      advance(cc, R + 1, tbl, obs);
      now = R + 1;
      sampleDay(cc, ss, d + 1);
      spec.onDay?.(cc, d + 1);
    }
  };

  const results: CountyResult[] = [];
  const done = (cc: CountyState, ss: Seat[], arm: string | null) => {
    finishSummaries(cc, ss, obs);
    const { steps: _s, onDay: _o, ...plain } = spec;
    results.push({
      spec: plain,
      arm,
      towns: ss.map((s) => s.summary),
      hash: countyHash(cc),
      roomBytes: JSON.stringify(cc).length,
      wallMs: performance.now() - t0,
      timings: obs?.timing ? obs.timings() : null,
    });
  };

  if (!spec.fork) {
    runDays(0, spec.days, c, seats, table);
    done(c, seats, null);
    return results;
  }
  runDays(0, spec.fork.atDay, c, seats, table);
  const frozen = JSON.stringify(c);
  const nowAtFork = now;
  const obsAtFork = obs?.save();
  for (const arm of spec.fork.arms) {
    const cc = JSON.parse(frozen) as CountyState;
    const ss: Seat[] = seats.map((s) => ({ ...s, style: { ...s.style, ...arm.style }, summary: JSON.parse(JSON.stringify(s.summary)) }));
    if (obs && obsAtFork) obs.restore(obsAtFork);
    now = nowAtFork;
    runDays(spec.fork.atDay, spec.days, cc, ss, table);
    done(cc, ss, arm.label);
  }
  return results;
}
