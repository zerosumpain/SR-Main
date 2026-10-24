// The Deputy's standing orders (WP2d, spec §5.18). They run in M13, after
// the books and Helper Mode, so they are as deterministic as the rest of the
// month: same state, same orders, same actions. A child's seat sees them as
// "if … then …" cards and can switch them on and off; an adult can also edit
// the thresholds and reorder them (at most 8). Every action Bramble takes is
// written to the inbox as a Deputy card (finance.ts deputyNote), so the
// Welcome-back sheet can say what happened while the mayor was away.
//
// Two orders act elsewhere and only read their switch here:
//   - buyUtilities: WP2a's auto-import (utilities.ts autoImport);
//   - renewContracts: WP3 renews a contract at the Regional Day (renewsContracts).
// fixDamaged is applied by WP2e's tick step (develop.ts repairs); Bramble
// reports the month's repair bill here.

import { ORDER_DEFAULTS, ZONE_DEFS } from './content';
import { lineIndex, postWhole } from './core';
import { civicMemo, deputyNote, levelPayment, monthsOfSpending, monthlySpending, type MonthBooks } from './finance';
import { appendTileEvent } from './records';
import { T_FOREST, TOWN_HALL_AT, buildable, terrainKind, terrainOf } from './terrain';
import { CAT_ROAD, MAP, TILES, USE_EMPTY, constructionLeft, parcelOpen, planesForWrite, planesOf, useCat, zoneUse } from './tiles';
import {
  EngineError,
  FUNDING_KEYS,
  FUND_LOW,
  METER_FARMS,
  METER_INDUSTRY,
  METER_SHOPS,
  Z_FARMS,
  Z_HOMES,
  Z_INDUSTRY,
  Z_SHOPS,
  type Actor,
  type Command,
  type CommandResult,
  type CountyState,
  type MonthContext,
  type StandingOrder,
  type TownState,
} from './types';
import type { Params } from './params';

/** Most orders a town may keep (§5.18). */
export const MAX_ORDERS = 8;

/** Bounds of each order's adult-editable thresholds (same order as ORDER_DEFAULTS' args). */
const ARG_BOUNDS: Record<string, readonly [number, number][]> = {
  budgetHealthy: [[0.5, 12], [0, 500]],
  awayZoning: [[0, 24], [0, 100], [0, 12]],
  repayLoan: [[0.5, 24]],
};

const FUN = FUNDING_KEYS.indexOf('fun');
const CULTURE = FUNDING_KEYS.indexOf('culture');

const orderOn = (t: TownState, kind: string): StandingOrder | null => {
  for (const o of t.orders) if (o.kind === kind) return o.on ? o : null;
  return null;
};

/** Does the Deputy renew this town's own contracts (WP3 asks at the Regional Day)? */
export function renewsContracts(t: TownState): boolean {
  return orderOn(t, 'renewContracts') !== null && orderOn(t, 'hold') === null;
}

// ---- The month (M13) ------------------------------------------------------------------------------------

/** Tiles in order of distance from the Town Hall (ties by index): where the Deputy zones first. */
const BY_DISTANCE: readonly number[] = (() => {
  const [hx, hy] = TOWN_HALL_AT;
  const tiles = Array.from({ length: TILES }, (_, i) => i);
  const d = (i: number) => Math.abs((i % MAP) - hx) + Math.abs(Math.floor(i / MAP) - hy);
  return tiles.sort((a, b) => d(a) - d(b) || a - b);
})();

function nextToRoad(use: Uint16Array, i: number): boolean {
  const x = i % MAP;
  const y = (i - x) / MAP;
  return (
    (x > 0 && useCat(use[i - 1]) === CAT_ROAD) ||
    (x < MAP - 1 && useCat(use[i + 1]) === CAT_ROAD) ||
    (y > 0 && useCat(use[i - MAP]) === CAT_ROAD) ||
    (y < MAP - 1 && useCat(use[i + MAP]) === CAT_ROAD)
  );
}

/** Zones up to `n` empty roadside tiles with zone `z` (nearest the Town Hall first); returns tiles zoned. */
function zoneRoadside(t: TownState, z: number, n: number): number {
  if (n <= 0) return 0;
  const terrain = terrainOf(t);
  const read = planesOf(t).use;
  const picks: number[] = [];
  for (const i of BY_DISTANCE) {
    if (picks.length >= n) break;
    if (read[i] !== USE_EMPTY || constructionLeft(t, i) > 0) continue;
    const v = terrain[i];
    if (!buildable(v) || terrainKind(v) === T_FOREST) continue;
    const x = i % MAP;
    if (!parcelOpen(t, x, (i - x) / MAP) || !nextToRoad(read, i)) continue;
    picks.push(i);
  }
  if (picks.length === 0) return 0;
  const w = planesForWrite(t);
  for (const i of picks) {
    w.use[i] = zoneUse(z);
    w.lvl[i] = 0;
    w.age[i] = 0;
    appendTileEvent(t, t.tick, i, 'zoned', z);
  }
  return picks.length;
}

function zoneAllowed(t: TownState, z: number): boolean {
  const d = ZONE_DEFS[z];
  return t.tier >= d.unlock && t.tier <= d.zoneUntil;
}

/** Repays up to `amount` of the Town Loan with the 1% early-repayment fee; returns the principal repaid. */
export function repayLoan(t: TownState, amount: number, p: Params): number {
  const loan = t.money.loan;
  if (!loan) return 0;
  const principal = Math.min(Math.floor(amount), Math.ceil(loan.principal));
  if (principal <= 0) return 0;
  const fee = Math.round(principal * p.finance.earlyRepay);
  postWhole(t, 'repayment', -principal);
  postWhole(t, 'interest', -fee);
  loan.principal -= principal;
  if (loan.principal < 1) t.money.loan = null;
  else loan.payment = levelPayment(loan.principal, loan.rate, loan.monthsLeft); // same term, smaller payment
  return principal;
}

/** Runs the standing orders in their list order (M13). "Hold" switches every other order off. */
export function runOrders(t: TownState, m: MonthContext, books: MonthBooks): void {
  if (orderOn(t, 'hold')) return;
  const memo = civicMemo(t);
  const spend = Math.max(1, books.spending);
  for (const o of t.orders) {
    if (!o.on) continue;
    switch (o.kind) {
      case 'budgetHealthy': {
        const [months, maxBp] = o.args;
        const low = t.money.reserves < months * spend;
        if (!low) {
          memo.deputyRaised = 0;
          break;
        }
        if (t.money.reserves >= t.books.open) break; // under the line but not falling
        if (t.funding[FUN] !== FUND_LOW || t.funding[CULTURE] !== FUND_LOW) {
          t.funding[FUN] = FUND_LOW;
          t.funding[CULTURE] = FUND_LOW;
          deputyNote(t, m, 'budgetHealthy.funding', { months: Math.round(monthsOfSpending(t) * 10) / 10 });
          break;
        }
        const step = Math.min(m.params.civic.deputyStep, maxBp - memo.deputyRaised);
        const top = m.params.finance.ranges.homes[1];
        if (step <= 0 || t.taxes.homes.every((v) => v >= top)) break;
        t.taxes = { ...t.taxes, homes: t.taxes.homes.map((v) => Math.min(top, v + step)), town: Math.min(top, t.taxes.town + step) };
        memo.deputyRaised += step;
        deputyNote(t, m, 'budgetHealthy.tax', { bp: step });
        break;
      }
      case 'awayZoning': {
        const [tiles, meterAt, months] = o.args;
        const away = m.at - t.away.lastHelloAt > m.params.clock.awayAfterMs;
        if (!away || t.money.reserves <= months * spend) break;
        if (memo.zonedDay !== m.dayIndex) {
          memo.zonedDay = m.dayIndex;
          memo.zonedToday = 0;
        }
        const left = Math.max(0, Math.floor(tiles) - memo.zonedToday);
        const homes = zoneAllowed(t, Z_HOMES) && Math.max(t.meters[0], t.meters[1], t.meters[2]) > meterAt;
        const shops = zoneAllowed(t, Z_SHOPS) && t.meters[METER_SHOPS] > meterAt;
        // Review amendment to §5.18: also the job zone (Industry or Farms, the higher meter) when it is
        // wanted. With Homes and Shops alone a town whose people had no work sat at a fixed point no
        // order could leave (Bramble's steps give 10 jobs for 96 founders: G8).
        const ind = zoneAllowed(t, Z_INDUSTRY) && t.meters[METER_INDUSTRY] > meterAt ? t.meters[METER_INDUSTRY] : -Infinity;
        const farm = zoneAllowed(t, Z_FARMS) && t.meters[METER_FARMS] > meterAt ? t.meters[METER_FARMS] : -Infinity;
        const jobZone = ind === -Infinity && farm === -Infinity ? -1 : farm > ind ? Z_FARMS : Z_INDUSTRY;
        const kinds = (homes ? 1 : 0) + (shops ? 1 : 0) + (jobZone >= 0 ? 1 : 0);
        if (left === 0 || kinds === 0) break;
        // An even split, the remainder to Homes first (fixed order: Homes, Shops, jobs).
        const share = Math.floor(left / kinds);
        let extra = left - share * kinds;
        const quota = () => share + (extra-- > 0 ? 1 : 0);
        const h = homes ? zoneRoadside(t, Z_HOMES, quota()) : 0;
        const s = shops ? zoneRoadside(t, Z_SHOPS, jobZone >= 0 ? quota() : left - h) : 0;
        const j = jobZone >= 0 ? zoneRoadside(t, jobZone, left - h - s) : 0;
        memo.zonedToday += h + s + j;
        if (h + s + j > 0) deputyNote(t, m, 'awayZoning', { homes: h, shops: s, jobs: j });
        break;
      }
      case 'repayLoan': {
        const [months] = o.args;
        if (!t.money.loan) break;
        const spare = t.money.reserves - months * monthlySpending(t);
        if (spare <= 0) break;
        const paid = repayLoan(t, spare / (1 + m.params.finance.earlyRepay), m.params);
        if (paid > 0) deputyNote(t, m, 'repayLoan', { paid });
        break;
      }
      case 'fixDamaged': {
        const bill = -t.books.lines[lineIndex('repairs')];
        if (bill > 0) deputyNote(t, m, 'fixDamaged', { cost: bill });
        break;
      }
      case 'buyUtilities': {
        // WP2a's M2 already imported (autoImport reads this switch); Bramble only reports it.
        const u = m.derived.utilities;
        if (u && (u.powerImported > 0 || u.waterImported > 0)) deputyNote(t, m, 'buyUtilities', { power: Math.round(u.powerImported), water: Math.round(u.waterImported), cost: Math.round(u.importCost) });
        break;
      }
      default:
        break;
    }
  }
}

// ---- The `orders` move ------------------------------------------------------------------------------------

/**
 * Replaces the town's standing orders. Adults may reorder, drop and edit
 * thresholds (bounded, at most 8 orders, each kind once); a child's seat may
 * only switch the existing orders on and off.
 */
export function ordersMove(c: CountyState, townIndex: number, cmd: Command, actor: Actor): CommandResult {
  if (cmd.type !== 'orders') throw new EngineError(400, 'That move is not a set of orders.');
  const t = c.towns[townIndex];
  const list = cmd.orders;
  if (!Array.isArray(list) || list.length > MAX_ORDERS) throw new EngineError(400, `Bramble can keep up to ${MAX_ORDERS} orders.`);
  const seen = new Set<string>();
  const next: StandingOrder[] = [];
  for (const o of list) {
    const def = ORDER_DEFAULTS.find((d) => d.kind === o?.kind);
    if (!def) throw new EngineError(400, 'That is not an order Bramble knows.');
    if (seen.has(def.kind)) throw new EngineError(400, 'Each order can only be given once.');
    seen.add(def.kind);
    if (typeof o.on !== 'boolean') throw new EngineError(400, 'Each order is on or off.');
    const args = Array.isArray(o.args) ? o.args : [];
    if (args.length !== def.args.length) throw new EngineError(400, 'That order has the wrong number of settings.');
    const bounds = ARG_BOUNDS[def.kind] ?? [];
    args.forEach((v, k) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < bounds[k][0] || v > bounds[k][1]) throw new EngineError(400, 'That setting is out of range.');
    });
    next.push({ kind: def.kind, on: o.on, args: [...args] });
  }
  const profile = actor.profile ?? c.settings.perSeat[actor.seat]?.profile ?? 'adult';
  if (profile === 'kid') {
    const same = next.length === t.orders.length && next.every((o, k) => o.kind === t.orders[k].kind && o.args.length === t.orders[k].args.length && o.args.every((v, j) => v === t.orders[k].args[j]));
    if (!same) throw new EngineError(403, 'Ask a grown-up to change how Bramble’s orders work: you can switch them on and off.');
  }
  t.orders = next;
  return { ok: true, atTick: t.tick, cost: 0 };
}
