// Shared bookkeeping every package uses: the only sanctioned ways to move a
// town's money and change its head-count (so the books always balance and
// the conservation invariants can be checked after every town-month), plus
// the empty records a new town or a new day starts from.

import { commitPlanes } from './tiles';
import { commitRecords } from './records';
import { takeCarry } from './num';
import {
  LEDGER_LINES,
  PEOPLE_COUNT,
  POP_FLOWS,
  type Books,
  type LedgerLine,
  type PopFlow,
  type RealisedDay,
  type TickContext,
  type TownDayFlows,
  type TownState,
} from './types';

const LINE_INDEX: Record<string, number> = {};
LEDGER_LINES.forEach((l, i) => (LINE_INDEX[l] = i));
const FLOW_INDEX: Record<string, number> = {};
POP_FLOWS.forEach((f, i) => (FLOW_INDEX[f] = i));

export const lineIndex = (l: LedgerLine): number => LINE_INDEX[l];
export const flowIndex = (f: PopFlow): number => FLOW_INDEX[f];

export function emptyBooks(reserves: number, pop: number): Books {
  return {
    open: reserves,
    lines: new Array<number>(LEDGER_LINES.length).fill(0),
    popOpen: pop,
    pop: new Array<number>(POP_FLOWS.length).fill(0),
    dayLines: new Array<number>(LEDGER_LINES.length).fill(0),
    dayPop: new Array<number>(POP_FLOWS.length).fill(0),
  };
}

/**
 * Moves money: rounds `amount` (£, a double) with the line's carry, adds the
 * integer to reserves and to the month and day books. Positive is revenue,
 * negative is spending. Returns the integer posted.
 */
export function postMoney(t: TownState, line: LedgerLine, amount: number): number {
  const n = takeCarry(t.carry, `£.${line}`, amount);
  if (n === 0) return 0;
  const i = LINE_INDEX[line];
  t.money.reserves += n;
  t.books.lines[i] += n;
  t.books.dayLines[i] += n;
  return n;
}

/** Posts an already-integer amount with no carry (prices, fees, refunds). */
export function postWhole(t: TownState, line: LedgerLine, amount: number): number {
  const n = Math.round(amount);
  if (n === 0) return 0;
  const i = LINE_INDEX[line];
  t.money.reserves += n;
  t.books.lines[i] += n;
  t.books.dayLines[i] += n;
  return n;
}

/**
 * Changes the head-count: adds `n` (an integer, may be negative) to person
 * stock `stock` (people[] index) and records it under a population flow.
 * Moves between stocks (ageing, settling down) do not change the head-count
 * and use moveStock instead. Never takes a stock below zero: returns the
 * amount actually applied.
 */
export function postPeople(t: TownState, flow: PopFlow, stock: number, n: number): number {
  let d = Math.round(n);
  if (d < 0 && -d > t.people[stock]) d = -t.people[stock];
  if (d === 0) return 0;
  t.people[stock] += d;
  const i = FLOW_INDEX[flow];
  t.books.pop[i] += d;
  t.books.dayPop[i] += d;
  return d;
}

/** Moves `n` persons between two stocks (bounded by the source), head-count unchanged. */
export function moveStock(t: TownState, from: number, to: number, n: number): number {
  let d = Math.round(n);
  if (d > t.people[from]) d = t.people[from];
  if (d <= 0) return 0;
  t.people[from] -= d;
  t.people[to] += d;
  return d;
}

/** A flow rounded with its carry: the canonical way to turn a rate into whole persons or pounds. */
export function flow(t: TownState, key: string, x: number): number {
  return takeCarry(t.carry, key, x);
}

export function population(t: TownState): number {
  let n = 0;
  for (let i = 0; i < PEOPLE_COUNT; i++) n += t.people[i];
  return n;
}

/** Rolls the month books (the driver calls it after the month step and its checks). */
export function rollMonthBooks(t: TownState): void {
  const b = t.books;
  b.open = t.money.reserves;
  b.popOpen = population(t);
  b.lines.fill(0);
  b.pop.fill(0);
}

/** Rolls the day books (the Regional Day calls it after closing the day). */
export function rollDayBooks(t: TownState): void {
  t.books.dayLines.fill(0);
  t.books.dayPop.fill(0);
}

export function emptyRealised(day: number, allocations = 0, contracts = 0): RealisedDay {
  return {
    day,
    commutersIn: [0, 0, 0],
    commutersOut: [0, 0, 0],
    shopperSpendIn: 0,
    shopperSpendOut: 0,
    dayTripSpend: 0,
    touristSpend: 0,
    visitorsHosted: 0,
    dayTripsHosted: 0,
    shipped: new Array<number>(allocations).fill(0),
    received: new Array<number>(allocations).fill(0),
    delivered: new Array<number>(contracts).fill(0),
    shortfall: new Array<number>(contracts).fill(0),
    sharedUsed: [0, 0],
  };
}

export function neutralFlows(): TownDayFlows {
  return {
    commutersIn: [0, 0, 0],
    commutersOut: [0, 0, 0],
    shoppersIn: 0,
    leak: 0,
    dayTripsIn: 0,
    touristShare: 0,
    touristPool: 0,
    sharedHealth: 0,
    sharedUniversity: 0,
    airIn: 0,
    advert: new Array<number>(10).fill(0),
    buzz: 0,
  };
}

/** Today's fixed flows for the town being stepped (neutral before its first Regional Day). */
export function flowsFor(ctx: TickContext): TownDayFlows {
  return ctx.snapshot.flows[ctx.townIndex] ?? NEUTRAL_FLOWS;
}
const NEUTRAL_FLOWS: TownDayFlows = (() => {
  const f = neutralFlows();
  for (const v of Object.values(f)) if (Array.isArray(v)) Object.freeze(v);
  return Object.freeze(f);
})();

/** Writes every decoded working copy back into the stored strings. */
export function commitTown(t: TownState): void {
  commitPlanes(t);
  commitRecords(t);
}
