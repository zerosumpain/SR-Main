// ============================================================================
//  STUBS (WP1). Every work package's step starts here as a clearly marked
//  no-op that keeps the invariants: it writes its blackboard slot's NEUTRAL
//  value (derived.ts) and changes no stored field, so the whole tick and the
//  Regional Day run end to end before any economy exists.
//
//  To land a package: implement the step in your own file with the SAME
//  signature, then change its one import line in steps.ts. Leave the stub
//  here (the Lab's off-rule identity runs and the core tests use them).
// ============================================================================

import { population } from './core';
import { neutral } from './derived';
import { pushHistoryMonth } from './records';
import type { CountyState, MonthContext, RegionalContext, TickContext, TownState } from './types';

// ---- WP2e (develop.ts) ------------------------------------------------------------

/** STUB WP2e tick steps 2–4 (§5.2): the development scan, incidents, founders' carts. */
export function stubDevelop(_t: TownState, _ctx: TickContext): void {}

/** STUB WP2e M1b: supply from tiles → derived.development. */
export function stubSupply(t: TownState, m: MonthContext): void {
  void t;
  m.derived.development = neutral.development();
}

/** STUB WP2e M14b: the development memo (last month's fields for the ticks); keeps nothing. */
export function stubDevelopMemo(_t: TownState, _m: MonthContext): void {}

// ---- WP2a (utilities.ts, fields.ts, services.ts, safety.ts, landvalue.ts, transport.ts) ---

/** STUB WP2a M2: grids, brownouts, auto-import → derived.utilities. */
export function stubUtilities(_t: TownState, m: MonthContext): void {
  m.derived.utilities = neutral.utilities();
}

/** STUB WP2a M3: coverage, pollution, noise, crime, access, land value → derived.fields, derived.coverage (+ t.lv, t.lag.poll). */
export function stubFields(t: TownState, m: MonthContext): void {
  m.derived.fields = neutral.fields(t);
  m.derived.coverage = neutral.coverage(t);
}

/** STUB WP2a M4: districts, travel times, loads, congestion → derived.travel (+ t.lag.congestion). */
export function stubTransport(_t: TownState, m: MonthContext): void {
  m.derived.travel = neutral.travel();
}

// ---- WP2b (labour.ts, housing.ts, people.ts, needs.ts, migration.ts) -------------------------

/** STUB WP2b M5: matching, commuting, wages, staffing → derived.labour (+ buildings[B_STAFF]). */
export function stubLabour(_t: TownState, m: MonthContext): void {
  m.derived.labour = neutral.labour();
}

/** STUB WP2b M7a: household budgets and rent → derived.housing. */
export function stubHouseholds(_t: TownState, m: MonthContext): void {
  m.derived.housing = neutral.housing();
}

/** STUB WP2b M9: demography (§4.3). */
export function stubDemography(_t: TownState, _m: MonthContext): void {}

/** STUB WP2b M10: stars, needs, perception → derived.stars, derived.needs (+ t.perceived). */
export function stubStars(t: TownState, m: MonthContext): void {
  m.derived.stars = neutral.stars(t);
  m.derived.needs = neutral.needs();
}

/** STUB WP2b M11: movers, Outside World arrivals and leavers, intents → derived.migration. */
export function stubMigration(_t: TownState, m: MonthContext): void {
  m.derived.migration = neutral.migration(Math.max(1, m.snapshot.towns.length));
}

/** STUB WP2b M12: allocation, vacancy, applicants, Homes meters, re-tiering (completes derived.housing). */
export function stubHousing(_t: TownState, _m: MonthContext): void {}

// ---- WP2c (business.ts, trade.ts, tourism.ts) ---------------------------------------------------

/** STUB WP2c M6: visitors, beds, satisfaction, reputation, awareness → derived.tourism. */
export function stubTourism(_t: TownState, m: MonthContext): void {
  m.derived.tourism = neutral.tourism();
}

/** STUB WP2c M7b: spending, shoppers, goods and food → derived.spend, derived.goods. */
export function stubSpending(_t: TownState, m: MonthContext): void {
  m.derived.spend = neutral.spend();
  m.derived.goods = neutral.goods();
}

/** STUB WP2c M8: sector revenue, cost, margins, business meters → derived.firms. */
export function stubFirms(_t: TownState, m: MonthContext): void {
  m.derived.firms = neutral.firms();
}

// ---- WP2d (finance.ts, policies.ts, orders.ts, mood.ts, tiers.ts, advisors.ts) -----------------

/** STUB WP2d M7c: tax receipts → derived.ledger. */
export function stubTaxReceipts(t: TownState, m: MonthContext): void {
  m.derived.ledger = neutral.ledger(t);
}

/** STUB WP2d M13: upkeep, debt service, rating, Helper Mode, standing orders (completes derived.ledger). */
export function stubFinance(t: TownState, m: MonthContext): void {
  const l = m.derived.ledger;
  if (l) l.lines = [...t.books.lines];
}

/** STUB WP2d M10b: happiness stays where it is. */
export function stubHappiness(_t: TownState, _m: MonthContext): void {}

/** STUB WP2d M14: Why records, history, advisor cards, wants, Town Talk → derived.mood. */
export function stubRecords(t: TownState, m: MonthContext): void {
  m.derived.mood = neutral.mood(t);
  pushHistoryMonth(t, { pop: population(t), reserves: t.money.reserves });
}

// ---- WP3 (regional-day.ts and friends) -------------------------------------------------------------

/** STUB WP3 §8.3 step 1: close the books (read t.realised). */
export function stubCloseBooks(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 2: move money between towns (conserved). */
export function stubMoveMoney(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 3: migration between players from the intents ledger. */
export function stubPlayerMigration(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 4: fix tomorrow's flows (county.flows, allocations, prices). */
export function stubFixFlows(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 5: the Great Work. */
export function stubGreatWork(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 6: deliver gifts, aid, pranks and adverts; ribbon cuttings. */
export function stubDeliver(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3/WP2d step 7: Town Talk, tier check, rating review, Initiatives, counters. */
export function stubYearEnd(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 8: the County Week (Sundays). */
export function stubCountyWeek(_c: CountyState, _r: RegionalContext): void {}
/** STUB WP3 step 10: the Morning Bulletin and today's push. */
export function stubBulletin(_c: CountyState, _r: RegionalContext): void {}

