// Town finance (WP2d, spec §5.13 with A14 and A16): the four taxes and the
// other receipts, civic, road and utility upkeep, the Town Loan and bonds,
// the overdraft, the credit rating, and Helper Mode in place of bankruptcy.
//
// Money moves only through postMoney/postWhole (core.ts), so every pound sits
// on a named ledger line and the books balance to the pound after every
// month (the driver's invariant check reverts a month that does not). Rates
// become integer pounds with one carry per line, so a 0.4% tax on a small
// base still adds up over the months instead of rounding to nothing.
//
// The month splits in two (A41):
//   - M7c receipts: the taxes whose bases are known by then (homes tax on
//     this month's rents, sales tax on this month's turnover, hotel tax on
//     tonight's beds) plus fares and tuition;
//   - M13 the rest: business tax on M8's turnover, upkeep, utility trade,
//     policy costs, debt service and overdraft interest; then the rating,
//     Helper Mode, and the Deputy's standing orders (orders.ts).
//
// Helper Mode is designed to end (A16, gate G11). Bramble's first steps
// (pause non-essential builds, Fun and Culture to Low, the tax floors, pause
// optional cards, a 0% Kingsport advance) usually restore a surplus; when a
// town is structurally in deficit they cannot, so the escalation pushes more
// services to Low at day 3 and the tax floors up at day 6, and at day 10
// Kingsport writes off whatever is still owed. No path stays in Helper Mode.

import { BUILDINGS, POLICIES, RAIL_DEF, ROAD_DEFS } from './content';
import { countyMonth, gridOfTownTick } from './clock';
import { lineIndex, population, postMoney, postWhole } from './core';
import { neutral } from './derived';
import { bp, formatPounds } from './num';
import { paramsFor, type Params } from './params';
import { repayLoan, runOrders } from './orders';
import { pauseOptionalCards, restorePausedCards } from './policies';
import { B_KIND, B_X, B_Y, CAT_RAIL, CAT_ROAD, TILES, constructionLeft, planesOf, tileIndex, useCat, usePayload } from './tiles';
import {
  EngineError,
  FUNDING_KEYS,
  FUND_LOW,
  LEDGER_LINES,
  PERSON_S,
  RATINGS,
  type CivicMemo,
  type Command,
  type CommandResult,
  type CountyState,
  type LedgerLine,
  type LedgerSlot,
  type Loan,
  type MonthContext,
  type TownState,
} from './types';
import { worldAt } from './world';

/** Recurring revenue: the base for borrowing limits and the debt-service ratio. */
export const REVENUE_LINES: readonly LedgerLine[] = [
  'homesTax', 'businessTax', 'salesTax', 'hotelTax', 'fares', 'utilitySales', 'contractIncome', 'sharedFees', 'dealLeases', 'commuterRule', 'tuition',
];
/** Running spending: what "months of spending" counts (capital, refunds and Helper Mode flows are not running costs). */
export const SPENDING_LINES: readonly LedgerLine[] = [
  'upkeepCivic', 'upkeepRoads', 'upkeepUtilities', 'utilityImports', 'loanService', 'bondService', 'interest', 'contractPayments', 'penalties',
  'policyCosts', 'repairs', 'fundContribution', 'greatWorkPledge',
];

const TIER_TOWN = 2;
const TIER_CITY = 3;
const RATING_B = RATINGS.length - 1;
const FUN = FUNDING_KEYS.indexOf('fun');
const CULTURE = FUNDING_KEYS.indexOf('culture');
/** A16's day-3 escalation: every service except Safety (police, fire) and Learning & Health (health, education). */
const ESCALATE_LOW = (['fun', 'culture', 'transit', 'roads', 'utilities'] as const).map((k) => FUNDING_KEYS.indexOf(k));

// ---- Memo ------------------------------------------------------------------------------------------

/** The civic memo, created on first use. */
export function civicMemo(t: TownState): CivicMemo {
  if (!t.civicMemo) {
    t.civicMemo = {
      revenue: 0,
      spending: 0,
      deputyRaised: 0,
      zonedDay: -1,
      zonedToday: 0,
      paused: [],
      check: { tier: t.tier + 1, met: 0, items: 0 },
      mood: 0,
      talk: [],
      wants: [],
      advisors: [],
      peak: 0,
      struggling: false,
    };
  }
  return t.civicMemo;
}

/** Last month's running spending, never below £1 (the months-of-spending denominator). */
export function monthlySpending(t: TownState): number {
  return Math.max(1, t.civicMemo?.spending ?? 0);
}

/** Reserves in months of last month's running spending. */
export function monthsOfSpending(t: TownState): number {
  return t.money.reserves / monthlySpending(t);
}

// ---- Arithmetic --------------------------------------------------------------------------------------

/**
 * Level amortisation: the monthly payment that clears `principal` in `months`
 * payments at `annual` interest. (1 + r)^n by repeated multiplication (no
 * pow, §5.13), so it is exact on every engine.
 */
export function levelPayment(principal: number, annual: number, months: number): number {
  const n = Math.max(1, Math.floor(months));
  const r = annual / 12;
  if (r <= 0) return principal / n;
  let f = 1;
  for (let i = 0; i < n; i++) f *= 1 + r;
  return (principal * r * f) / (f - 1);
}

/** Funding multiplier (Low ×0.7, Normal ×1.0, High ×1.3) of a FUNDING_KEYS index. */
function fundMult(t: TownState, p: Params, key: number): number {
  return p.finance.fundingMult[t.funding[key] ?? 1] ?? 1;
}

/** A homes-weighted mean homes tax in bp (the Approval and Town Talk tax terms). */
export function meanHomesTax(t: TownState): number {
  let n = 0;
  let s = 0;
  for (let h = 0; h < 3; h++) {
    const k = t.people[h] + t.people[3 + h] + t.people[6 + h] + t.people[9 + h];
    n += k;
    s += k * (t.taxes.homes[h] ?? 0);
  }
  return n > 0 ? s / n : (t.taxes.homes[0] ?? 0);
}

// ---- Upkeep (A14: catalogue upkeeps × funding × civicUpkeepScale) ----------------------------------

export interface Upkeep {
  /** £ a month, positive. */
  civic: number;
  utilities: number;
  roads: number;
  /** Per building index (finished buildings; 0 while under construction). */
  perBuilding: number[];
}

/**
 * What the town's buildings and roads cost to run this month. Buildings pay
 * from completion; power and water plants go on the utilities line, every
 * other building on the civic line, and both scale with their own funding
 * dial and finance.civicUpkeepScale (the Lab's calibration knob, A14). Roads
 * scale with the Roads dial; the County Road is Kingsport's.
 */
export function upkeepOf(t: TownState, p: Params): Upkeep {
  const scale = p.finance.civicUpkeepScale;
  const N = population(t);
  const out: Upkeep = { civic: 0, utilities: 0, roads: 0, perBuilding: new Array<number>(t.buildings.length).fill(0) };
  for (let i = 0; i < t.buildings.length; i++) {
    const b = t.buildings[i];
    const def = BUILDINGS[b[B_KIND]];
    if (!def || constructionLeft(t, tileIndex(b[B_X], b[B_Y])) > 0) continue;
    const base = def.upkeep + (def.upkeepPerResident ?? 0) * N;
    const cost = base * fundMult(t, p, FUNDING_KEYS.indexOf(def.funding)) * scale;
    out.perBuilding[i] = cost;
    if (def.group === 'power' || def.group === 'water') out.utilities += cost;
    else out.civic += cost;
  }
  const pl = planesOf(t);
  const perKind = ROAD_DEFS.map((r) => r.upkeep);
  let road = 0;
  for (let i = 0; i < TILES; i++) {
    const u = pl.use[i];
    const cat = useCat(u);
    if (cat === CAT_ROAD) road += perKind[usePayload(u)] ?? 0;
    else if (cat === CAT_RAIL) road += RAIL_DEF.upkeep;
  }
  out.roads = road * fundMult(t, p, FUNDING_KEYS.indexOf('roads'));
  return out;
}

/** A policy card's money a month (negative = cost; Night Market earns). Free Bus Fridays is charged through fares. */
export function policyMoney(t: TownState, card: string): number {
  const def = POLICIES.find((d) => d.id === card);
  if (!def) return 0;
  const N = population(t);
  switch (def.cost.kind) {
    case 'perResident':
      return -def.cost.amount * N;
    case 'flat':
      return -def.cost.amount;
    case 'earnsPerResident':
      return def.cost.amount * N;
    default:
      return 0;
  }
}

// ---- Rates ------------------------------------------------------------------------------------------

/** r_base for the town's current tick (the World's annual base rate). */
export function baseRate(c: CountyState, t: TownState, p: Params): number {
  const s = c.snapshot;
  const month = countyMonth(gridOfTownTick(t, t.tick));
  return worldAt(s.worldSeed, month, { startMonth: s.season.startMonth, boomBust: s.season.boomBust }, p).rBase;
}

/** Monthly debt service at the current terms (£). */
export function debtService(t: TownState): number {
  let s = t.money.loan ? t.money.loan.payment : 0;
  for (const b of t.money.bonds) s += b.payment;
  return s;
}

/** Outstanding principal of the loan and every bond (£). */
export function debtOutstanding(t: TownState): number {
  let s = t.money.loan ? t.money.loan.principal : 0;
  for (const b of t.money.bonds) s += b.principal;
  return s;
}

// ---- M7c: tax receipts ----------------------------------------------------------------------------------

/** STEP M7c (WP2d): homes, sales and hotel tax, fares and tuition → derived.ledger (completed in M13). */
export function stepTaxReceipts(t: TownState, m: MonthContext): void {
  const p = m.params;
  const f = p.finance;
  const hs = m.derived.housing ?? neutral.housing();
  const why = m.why;

  // Homes tax: Σ_h rate_h · rent_h · residents_h, paid on top of rent (council-tax-like).
  // Keep Homes Affordable's "yield −20% there" needs no term here: WP2b's rent already
  // charges ×0.8 inside the painted area, and the tax is a share of that rent.
  let homes = 0;
  const tierTerm = ['line.tier.L', 'line.tier.M', 'line.tier.H'];
  for (let h = 0; h < 3; h++) {
    const due = bp(t.taxes.homes[h] ?? 0) * (hs.rent[h] ?? 0) * (hs.occ[h] ?? 0);
    homes += due;
    why.add(tierTerm[h], due, 'line.homesTax');
  }
  why.set('line.homesTax', postMoney(t, 'homesTax', homes));

  // Sales tax (from Town) on retail and leisure turnover, visitors' and shoppers' included.
  if (t.tier >= TIER_TOWN) {
    const sp = m.derived.spend ?? neutral.spend();
    postMoney(t, 'salesTax', bp(t.taxes.sales) * sp.turnover);
  }
  // Hotel tax (from City) on hotel nights at the night price.
  if (t.tier >= TIER_CITY) {
    const tr = m.derived.tourism ?? neutral.tourism();
    postMoney(t, 'hotelTax', bp(t.taxes.hotel) * tr.hotelNights * p.tourism.hotelNight);
  }
  // Fares (from Town): riders' trips at £1.20; Free Bus Fridays waives a seventh of the bus fares.
  if (t.tier >= TIER_TOWN) {
    const tv = m.derived.travel ?? neutral.travel();
    const lab = m.derived.labour ?? neutral.labour();
    const commuters = (lab.employed[0] ?? 0) + (lab.employed[1] ?? 0) + (lab.employed[2] ?? 0);
    const free = POLICIES.find((d) => d.id === 'freeBusFridays')!.cost.amount;
    const busF = t.policies.some((a) => a.card === 'freeBusFridays') ? 1 - free : 1;
    const trips = commuters * f.tripsPerCommuter;
    postMoney(t, 'fares', trips * f.fares * (tv.busShare * busF + tv.railShare));
  }
  // University fees.
  postMoney(t, 'tuition', t.people[PERSON_S] * f.tuition);

  m.derived.ledger = { lines: [...t.books.lines], revenue: 0, spending: 0, net: 0, monthsOfSpending: 0 };
}

// ---- M13: the rest of the month ------------------------------------------------------------------------

/** Pays one month on a loan or bond: interest at annual/12, then principal; returns the £ paid (a double). */
function serviceDebt(d: Loan): number {
  const interest = (d.principal * d.rate) / 12;
  let pay = d.payment;
  if (d.monthsLeft <= 1 || pay > d.principal + interest) pay = d.principal + interest;
  d.principal = d.principal + interest - pay;
  if (d.principal < 0.5) d.principal = 0;
  d.monthsLeft -= 1;
  return pay;
}

function sumLines(t: TownState, lines: readonly LedgerLine[]): number {
  let s = 0;
  for (const l of lines) s += t.books.lines[lineIndex(l)];
  return s;
}

/** The finance facts the rest of M13 (rating, Helper Mode, orders) works from. */
export interface MonthBooks {
  revenue: number;
  spending: number;
  debtService: number;
  rBase: number;
}

/** STEP M13 (WP2d): business tax, upkeep, utility trade, policies, debt, then rating, Helper Mode and orders (completes derived.ledger). */
export function stepFinance(t: TownState, m: MonthContext): void {
  const p = m.params;
  const f = p.finance;
  const memo = civicMemo(t);

  // Business tax on M8's open-sector turnover (a Start-up Holiday's share is already left out).
  const firms = m.derived.firms ?? neutral.firms();
  postMoney(t, 'businessTax', bp(t.taxes.business) * firms.turnover);

  // Utility trade with Kingsport, priced by WP2a in M2.
  const u = m.derived.utilities ?? neutral.utilities();
  postMoney(t, 'utilitySales', u.exportIncome);
  postMoney(t, 'utilityImports', -u.importCost);

  // Upkeep.
  const up = upkeepOf(t, p);
  postMoney(t, 'upkeepCivic', -up.civic);
  postMoney(t, 'upkeepUtilities', -up.utilities);
  postMoney(t, 'upkeepRoads', -up.roads);

  // Policy cards' monthly money (Free Bus Fridays is in the fares).
  let pol = 0;
  for (const a of t.policies) pol += policyMoney(t, a.card);
  postMoney(t, 'policyCosts', pol);

  // Debt service: the Town Loan, then bonds in issue order.
  let service = 0;
  const loan = t.money.loan;
  if (loan) {
    const paid = serviceDebt(loan);
    service += paid;
    postMoney(t, 'loanService', -paid);
    if (loan.monthsLeft <= 0 || loan.principal <= 0) t.money.loan = null;
  }
  for (const b of t.money.bonds) {
    const paid = serviceDebt(b);
    service += paid;
    postMoney(t, 'bondService', -paid);
  }
  t.money.bonds = t.money.bonds.filter((b) => b.monthsLeft > 0 && b.principal > 0);

  // The overdraft costs r_base + 8% a year on what is overdrawn.
  if (t.money.reserves < 0) postMoney(t, 'interest', (t.money.reserves * (m.world.rBase + f.overdraftSpread)) / 12);

  const revenue = Math.max(0, sumLines(t, REVENUE_LINES));
  const spending = Math.max(0, -sumLines(t, SPENDING_LINES));
  memo.revenue = revenue;
  memo.spending = spending;
  const books: MonthBooks = { revenue, spending, debtService: service, rBase: m.world.rBase };

  t.money.overdraftMonths = t.money.reserves < 0 ? t.money.overdraftMonths + 1 : 0;
  reviewRating(t, m, books);
  helperMode(t, m, books);
  runOrders(t, m, books);
  t.money.fundAdvance = t.money.helper ? t.money.helper.advance : 0;

  const slot: LedgerSlot = m.derived.ledger ?? { lines: [], revenue: 0, spending: 0, net: 0, monthsOfSpending: 0 };
  slot.lines = [...t.books.lines];
  slot.revenue = revenue;
  slot.spending = spending;
  slot.net = revenue - spending;
  slot.monthsOfSpending = t.money.reserves / Math.max(1, spending);
}

// ---- The credit rating (§5.13) --------------------------------------------------------------------------------

/** The notch the town's numbers point at this month (0 AAA … 5 B), before the 3-month hold. */
export function ratingTarget(t: TownState, m: Pick<MonthContext, 'params' | 'dayIndex'>, books: Pick<MonthBooks, 'revenue' | 'spending' | 'debtService'>): number {
  const f = m.params.finance;
  const dsr = books.debtService / Math.max(1, books.revenue);
  const res = t.money.reserves / Math.max(1, books.spending);
  let target = RATING_B;
  for (let r = 0; r < f.ratingDsr.length; r++) {
    const resOk = r < f.ratingReserves.length ? res >= f.ratingReserves[r] : true;
    if (dsr < f.ratingDsr[r] && resOk) {
      target = r;
      break;
    }
  }
  if (t.money.overdraftMonths > f.ratingOverdraftMonths) target = RATING_B;
  // A Helper Mode episode in the last 24 months costs a notch (12 county months a day).
  const last = t.money.lastHelperDay;
  if (last !== null && (m.dayIndex - last) * 12 < f.helperMemoryMonths) target = Math.min(RATING_B, target + 1);
  return target;
}

/** Monthly review: a change needs its condition to hold for 3 months, and moves one notch at a time. */
function reviewRating(t: TownState, m: MonthContext, books: MonthBooks): void {
  const target = ratingTarget(t, m, books);
  const mo = t.money;
  if (target < mo.rating) mo.ratingHold = mo.ratingHold > 0 ? mo.ratingHold + 1 : 1;
  else if (target > mo.rating) mo.ratingHold = mo.ratingHold < 0 ? mo.ratingHold - 1 : -1;
  else mo.ratingHold = 0;
  const need = m.params.finance.ratingHoldMonths;
  if (mo.ratingHold >= need) {
    mo.rating -= 1;
    mo.ratingHold = 0;
  } else if (mo.ratingHold <= -need) {
    mo.rating += 1;
    mo.ratingHold = 0;
  }
}

// ---- Helper Mode (§5.13, A16) ------------------------------------------------------------------------------------

/** Takes a 0% Kingsport advance that brings reserves back to zero. */
function advanceToZero(t: TownState): number {
  const h = t.money.helper;
  if (!h || t.money.reserves >= 0) return 0;
  const n = postWhole(t, 'helperAdvance', -t.money.reserves);
  h.advance += n;
  return n;
}

/** Escalation step for a Helper Mode episode `days` Regional Days old (0, 1 at day 3, 2 at day 6). */
export function helperStep(days: number, p: Params): number {
  const [a, b] = p.finance.helperEscalateDays;
  return days >= b ? 2 : days >= a ? 1 : 0;
}

/** Bramble's settings for the current step; idempotent, so it runs every month of an episode. */
function applyHelperSettings(t: TownState, m: MonthContext): void {
  const h = t.money.helper!;
  const f = m.params.finance;
  t.funding[FUN] = FUND_LOW;
  t.funding[CULTURE] = FUND_LOW;
  if (h.step >= 1) for (const k of ESCALATE_LOW) t.funding[k] = FUND_LOW;
  const homesMin = f.helperHomesFloor[h.step >= 2 ? 1 : 0];
  const bizMin = f.helperBusinessFloor[h.step >= 2 ? 1 : 0];
  const homes = t.taxes.homes.map((v) => Math.max(v, homesMin));
  t.taxes = { ...t.taxes, homes, business: Math.max(t.taxes.business, bizMin), town: Math.max(t.taxes.town, homesMin) };
  pauseOptionalCards(t);
}

/** Leaves Helper Mode: the advance repaid (or written off), cards restored, the episode remembered. */
function exitHelper(t: TownState, m: MonthContext, writeOff: boolean): void {
  const h = t.money.helper!;
  const mo = t.money;
  deputyNote(t, m, writeOff ? 'helper.writeOff' : 'helper.exit', { owed: Math.round(h.advance), days: m.dayIndex - h.sinceDay });
  mo.helper = null;
  mo.lastHelperDay = m.dayIndex;
  if (writeOff) mo.lastWriteOffDay = m.dayIndex;
  // The advance left reserves at zero, so the overdraft count starts again: without this a
  // written-off town still showed 3+ overdrawn month ends and re-entered the very next month.
  mo.overdraftMonths = 0;
  mo.rating = writeOff ? RATING_B : Math.min(RATING_B, mo.rating + 1);
  mo.ratingHold = 0;
  restorePausedCards(t);
}

function helperMode(t: TownState, m: MonthContext, books: MonthBooks): void {
  const f = m.params.finance;
  const mo = t.money;
  const spend = Math.max(1, books.spending);
  if (!mo.helper) {
    const deep = mo.reserves < -f.overdraftLimit * spend;
    const long = mo.overdraftMonths >= f.overdraftTriggerMonths;
    if (!deep && !long) return;
    mo.helper = { sinceDay: m.dayIndex, sinceTick: t.tick, advance: 0, step: 0 };
    deputyNote(t, m, 'helper.enter', { reserves: mo.reserves });
  }
  const h = mo.helper;
  const days = m.dayIndex - h.sinceDay;
  h.step = helperStep(days, m.params);
  applyHelperSettings(t, m);
  advanceToZero(t);
  if (days >= f.helperWriteOffDays) {
    exitHelper(t, m, true);
    return;
  }
  // Repaid first from surpluses: whatever reserves the month left goes to Kingsport until the advance is clear.
  if (h.advance > 0 && mo.reserves > 0) {
    const n = postWhole(t, 'helperRepay', -Math.min(h.advance, mo.reserves));
    h.advance += n;
  }
  if (h.advance <= 0 && mo.reserves >= f.helperExitMonths * spend) exitHelper(t, m, false);
}

// ---- The Deputy's log -----------------------------------------------------------------------------------------------

/**
 * Records something Bramble did (§5.18: every action appears in the
 * Welcome-back cards). One inbox card per kind (and `key`, for things worth
 * a card each) per day, its numbers summed, so a month-by-month habit does
 * not flood the inbox; only the Deputy's own cards are trimmed.
 */
export function deputyNote(t: TownState, m: Pick<MonthContext, 'dayIndex' | 'params'>, kind: string, data: Record<string, number | string>, key?: string): void {
  const id = `deputy.${kind}.${m.dayIndex}${key ? `.${key}` : ''}`;
  const hit = t.inbox.find((x) => x.id === id);
  if (hit) {
    for (const k of Object.keys(data).sort()) {
      const v = data[k];
      const old = hit.data[k];
      hit.data[k] = typeof v === 'number' && typeof old === 'number' ? old + v : v;
    }
    hit.data.times = (typeof hit.data.times === 'number' ? hit.data.times : 1) + 1;
    return;
  }
  t.inbox.push({ id, kind: `deputy.${kind}`, day: m.dayIndex, from: null, data: { ...data } });
  const keep = m.params.civic.deputyLogKeep;
  let mine = 0;
  for (const x of t.inbox) if (x.kind.startsWith('deputy.')) mine++;
  while (mine > keep) {
    const i = t.inbox.findIndex((x) => x.kind.startsWith('deputy.'));
    t.inbox.splice(i, 1);
    mine--;
  }
  while (t.inbox.length > 40) t.inbox.shift();
}

/** LEDGER_LINES index list (for tests and the page's Ledger). */
export const LINE_COUNT = LEDGER_LINES.length;

// ---- Borrowing moves (§5.13) -------------------------------------------------------------------------------------

/**
 * Why a town may not borrow `amount` more, or null if it may (caps: 2×
 * annual revenue; no borrowing at a DSR ≥ 25%; none in Helper Mode or for
 * writeOffBorrowBarDays after a write-off, so a write-off cannot be used to
 * service debt borrowed for the purpose).
 */
export function borrowRefusal(t: TownState, amount: number, p: Params, dayIndex: number): string | null {
  if (t.money.helper) return 'Nobody lends to a town while Kingsport is helping it: let’s get the books straight first.';
  const w = t.money.lastWriteOffDay ?? null;
  if (w !== null && dayIndex - w < p.finance.writeOffBorrowBarDays) return 'Kingsport cleared our debts very recently, so the banks are waiting to see us balance the books first.';
  const rev = civicMemo(t).revenue;
  if (rev <= 0) return 'Penny needs a month of the budget before anyone will lend to us.';
  if (debtService(t) / rev >= p.finance.dsrStop) return 'Repayments already take a quarter of our revenue: no new borrowing for now.';
  const cap = p.finance.debtCapYears * 12 * rev;
  if (debtOutstanding(t) + amount > cap) return `That would take our debts past ${formatPounds(cap)}, two years of revenue.`;
  return null;
}

function wholeAmount(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new EngineError(400, `${what} must be a whole number of pounds.`);
  return v;
}

/** The `loan` move: take the Town Loan (Town and up), or repay some or all of it early (1% fee). */
export function loanMove(c: CountyState, townIndex: number, cmd: Command): CommandResult {
  if (cmd.type !== 'loan') throw new EngineError(400, 'That move is not a loan.');
  const t = c.towns[townIndex];
  const p = paramsFor(c.paramsVersion);
  const f = p.finance;
  if (cmd.take !== undefined) {
    const amount = wholeAmount(cmd.take, 'A loan');
    if (t.tier < TIER_TOWN) throw new EngineError(409, 'The Town Loan unlocks at Town.');
    if (t.money.loan) throw new EngineError(409, 'Pay back the Town Loan before taking a new one.');
    const limit = Math.floor(f.loanMultiple * civicMemo(t).revenue);
    if (amount > limit) throw new EngineError(409, `The Town Loan can be at most ${formatPounds(limit)}, a year of revenue.`);
    const no = borrowRefusal(t, amount, p, c.dayIndex);
    if (no) throw new EngineError(409, no);
    const rate = baseRate(c, t, p) + f.loanSpread;
    t.money.loan = { principal: amount, rate, monthsLeft: f.loanMonths, payment: levelPayment(amount, rate, f.loanMonths) };
    postWhole(t, 'borrowing', amount);
    return { ok: true, atTick: t.tick, cost: -amount, data: { rate, payment: Math.round(t.money.loan.payment) } };
  }
  if (cmd.repay !== undefined) {
    const amount = wholeAmount(cmd.repay, 'A repayment');
    const loan = t.money.loan;
    if (!loan) throw new EngineError(409, 'There is no Town Loan to pay back.');
    const principal = Math.min(amount, Math.ceil(loan.principal));
    const total = principal + Math.round(principal * f.earlyRepay);
    if (total > t.money.reserves) throw new EngineError(409, `Paying that back costs ${formatPounds(total)} with the 1% fee, and we have ${formatPounds(Math.max(0, t.money.reserves))}.`);
    repayLoan(t, principal, p);
    return { ok: true, atTick: t.tick, cost: total };
  }
  throw new EngineError(400, 'Say how much to borrow or pay back.');
}

/** The `bond` move: issue a bond (City and up) of 3, 6 or 12 months' revenue over 10 or 20 years, or repay one early. */
export function bondMove(c: CountyState, townIndex: number, cmd: Command): CommandResult {
  if (cmd.type !== 'bond') throw new EngineError(400, 'That move is not a bond.');
  const t = c.towns[townIndex];
  const p = paramsFor(c.paramsVersion);
  const f = p.finance;
  if (cmd.issue) {
    const { size, years } = cmd.issue;
    if (t.tier < TIER_CITY) throw new EngineError(409, 'Bonds unlock at City.');
    if (size !== 3 && size !== 6 && size !== 12) throw new EngineError(400, 'A bond is 3, 6 or 12 months of revenue.');
    if (years !== 10 && years !== 20) throw new EngineError(400, 'A bond runs for 10 or 20 years.');
    const amount = Math.floor(size * civicMemo(t).revenue);
    const no = borrowRefusal(t, amount, p, c.dayIndex);
    if (no) throw new EngineError(409, no);
    const rate = baseRate(c, t, p) + f.bondSpreads[t.money.rating];
    const months = years * 12;
    const id = `bond-${cmd.moveId}`;
    if (t.money.bonds.some((b) => b.id === id)) throw new EngineError(409, 'That bond has already been issued.');
    t.money.bonds.push({ id, issuedMonth: countyMonth(gridOfTownTick(t, t.tick)), principal: amount, rate, monthsLeft: months, payment: levelPayment(amount, rate, months) });
    postWhole(t, 'borrowing', amount);
    return { ok: true, atTick: t.tick, cost: -amount, data: { id, rate, amount } };
  }
  if (cmd.repay) {
    const at = t.money.bonds.findIndex((b) => b.id === cmd.repay!.id);
    if (at < 0) throw new EngineError(404, 'That bond is not ours to repay.');
    const b = t.money.bonds[at];
    const principal = Math.ceil(b.principal);
    const fee = Math.round(principal * f.earlyRepay);
    if (principal + fee > t.money.reserves) throw new EngineError(409, `Repaying that bond costs ${formatPounds(principal + fee)} with the 1% fee.`);
    postWhole(t, 'repayment', -principal);
    postWhole(t, 'interest', -fee);
    t.money.bonds.splice(at, 1);
    return { ok: true, atTick: t.tick, cost: principal + fee };
  }
  throw new EngineError(400, 'Say whether to issue or repay a bond.');
}
