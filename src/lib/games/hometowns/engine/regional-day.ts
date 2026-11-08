// The Regional Day's settlement steps (WP3, spec §8.3 steps 1, 2, 6 and 7):
// closing each town's books for the day, moving money between towns,
// delivering what the day's moves sent, and the year end's counters.
//
// The Regional Day is the ONLY coupling between towns (§8.3). Every step
// here reads what each town realised today (t.realised, its day books) and
// yesterday's fixed flows, and writes county state and towns in one batch
// with one writer, so the order towns were stepped in during the day cannot
// matter. Money moves only through region-state's transfer, escrow and
// Kingsport helpers, so the county's pounds are conserved to the penny.
//
// Leaving (A33, decided default: sites are never freed in v1). When a mayor
// leaves or is erased, the adapter freezes their town at once (archived);
// the next Regional Day settles everything else: links close without
// notice (the partner keeps its half of the road as a dead-end signpost),
// contracts and shared places end with no penalties and Kingsport covers the
// partner, pacts and Twin status dissolve, intents both ways are dropped,
// offers lapse with refunds, and Initiatives and the inbox are discarded.
// The town is renamed "Old <name>" (erasure already renamed it "Old Town
// <site>"). Great Work pledges stay delivered and credited (M3).

import { lineIndex, population, postWhole } from './core';
import { contractBand, payBusServices, settleOffers } from './offers';
import { meanStar } from './region';
import {
  countKind,
  countyMedian,
  emptyWeek,
  escrowToKingsport,
  inboxNote,
  isActive,
  MAX_TOWNS,
  monthsToday,
  onHoliday,
  pair,
  payFromEscrow,
  payKingsport,
  pp,
  regionOf,
  rp,
  transfer,
} from './region-state';
import { shortfallCharge } from './trade';
import { worldAt } from './world';
import { COHORT_COUNT, LEDGER_LINES, STARS, type Allocation, type Contract, type CountyState, type RegionalContext, type TownState } from './types';


const SAFETY = STARS.indexOf('safety');
const AROUND = STARS.indexOf('around');
const K = COHORT_COUNT;

// ---- Leavers (A33) -----------------------------------------------------------------------------

/** Settles every archived town not yet settled (step 1's start). */
export function settleLeavers(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (!t.archived || g.settled.includes(i)) continue;
    g.settled.push(i);
    // Links close at once, without notice.
    c.links = c.links.filter((l) => {
      if (l.a !== i && l.b !== i) return true;
      if (l.state === 'proposed') {
        payFromEscrow(c, l.a, l.paid[0], 'refunds');
        payFromEscrow(c, l.b, l.paid[1], 'refunds');
      }
      const other = l.a === i ? l.b : l.a;
      if (l.state === 'open' || l.state === 'closing') note(c, other, r.dayIndex, 'linkClosed', { with: i, kind: l.kind, reason: 'archived' });
      return false;
    });
    // Contracts and shared places end now, with no penalties; Kingsport covers the partner.
    c.contracts = c.contracts.filter((k) => k.seller !== i && k.buyer !== i);
    g.shares = g.shares.filter((s) => s.provider !== i && s.user !== i);
    c.pacts = c.pacts.filter((x) => x.a !== i && x.b !== i);
    g.campaigns = g.campaigns.filter((x) => x.from !== i && x.to !== i);
    // Offers to or from it lapse (settleOffers refunds the escrow at step 2).
    // Intents in both directions are dropped.
    const n = c.towns.length;
    for (let j = 0; j < n; j++)
      for (let k = 0; k < K; k++) {
        if ((i * n + j) * K + k < c.ledger.length) c.ledger[(i * n + j) * K + k] = 0;
        if ((j * n + i) * K + k < c.ledger.length) c.ledger[(j * n + i) * K + k] = 0;
      }
    for (const o of c.towns) if (o.realised.intents) for (let k = 0; k < K; k++) if (i * K + k < o.realised.intents.length) o.realised.intents[i * K + k] = 0;
    t.realised.intents = undefined;
    // What was theirs to spend or read.
    t.initiatives = 0;
    t.inbox = [];
    t.holiday.until = null;
    g.holidayFrom[i] = null;
    if (c.council.votes[i] !== undefined) c.council.votes[i] = null;
    g.bids[i] = '';
    if (!t.name.startsWith('Old ')) t.name = `Old ${t.name}`.slice(0, 32);
  }
}

// ---- Step 1: close the books --------------------------------------------------------------------

/** STEP §8.3 1 (WP3): settle leavers, then gather each town's intents for step 3. */
export function stepCloseBooks(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  settleLeavers(c, r);
  // The day's deliveries in sender order (stable, so each sender's own order
  // stands): what a town receives cannot depend on how two other towns'
  // moves happened to interleave.
  g.outbox.sort((x, y) => x.from - y.from);
  const n = c.towns.length;
  if (c.ledger.length !== n * n * K) {
    const next = new Array<number>(n * n * K).fill(0);
    for (let x = 0; x < Math.min(next.length, c.ledger.length); x++) next[x] = c.ledger[x];
    c.ledger = next;
  }
  // Intents I[i→j][k] accrued all day in each town's RealisedDay (WP2b, doubles).
  for (let i = 0; i < n; i++) {
    const t = c.towns[i];
    const acc = t.realised.intents;
    if (!acc || !isActive(t)) continue;
    for (let j = 0; j < n; j++) {
      if (j === i || c.towns[j].archived) continue;
      for (let k = 0; k < K; k++) {
        const x = acc[j * K + k] ?? 0;
        if (Number.isFinite(x) && x > 0) c.ledger[(i * n + j) * K + k] += x;
      }
    }
  }
}

// ---- Step 2: move money -------------------------------------------------------------------------

/** £ per commuter-month under the Council's commuter rule (§8.5). */
export function commuterRate(c: CountyState): number {
  const q = rp(c);
  return q.commuterRule[regionOf(c).commuterRule] ?? q.commuterRule[q.commuterRuleDefault];
}

/**
 * The commuter rule: a work town pays each home town per commuter-month that
 * actually worked today (its RealisedDay), split over home towns by the
 * pairs fixed yesterday.
 */
function commuterTransfers(c: CountyState): void {
  const rate = commuterRate(c);
  if (!(rate > 0)) return;
  const g = regionOf(c);
  const n = c.towns.length;
  for (let w = 0; w < n; w++) {
    if (!isActive(c.towns[w])) continue;
    for (let h = 0; h < 3; h++) {
      const worked = c.towns[w].realised.commutersIn[h] ?? 0;
      if (!(worked > 0)) continue;
      let planned = 0;
      for (let j = 0; j < n; j++) planned += g.commute[(j * MAX_TOWNS + w) * 3 + h] ?? 0;
      if (!(planned > 0)) continue;
      for (let j = 0; j < n; j++) {
        const share = (g.commute[(j * MAX_TOWNS + w) * 3 + h] ?? 0) / planned;
        if (share > 0 && isActive(c.towns[j])) transfer(c, w, j, rate * worked * share, 'commuterRule', 'commuterRule');
      }
    }
  }
}

/** Contract payments and A17 shortfall penalties for the contracts that ran today (yesterday's snapshot list). */
function contractPayments(c: CountyState): void {
  const ran: readonly Contract[] = c.snapshot.contracts ?? [];
  const weekMonths = rp(c).contractShortfallWeeks * rp(c).weekDays * 12;
  for (let x = 0; x < ran.length; x++) {
    const k = ran[x];
    if (k.seller >= c.towns.length || k.buyer >= c.towns.length) continue;
    const s = c.towns[k.seller];
    const b = c.towns[k.buyer];
    if (s.archived || b.archived) continue; // A33: no payments or penalties once either side has left.
    const delivered = Math.max(0, s.realised.delivered[x] ?? 0);
    const short = Math.max(0, s.realised.shortfall[x] ?? 0);
    if (k.kind === 'freight') {
      // The shipping partner earns £20 per industry job-month it carried (§8.7).
      transfer(c, k.buyer, k.seller, k.price * delivered, 'contractPayments', 'contractIncome');
      continue;
    }
    transfer(c, k.buyer, k.seller, k.price * delivered, 'contractPayments', 'contractIncome');
    // Kingsport filled the buyer's gap at its import price; the seller pays the buyer the difference, capped at a week of the contract.
    const [, imp] = contractBand(c, k.kind);
    const owed = Math.min(Math.max(0, imp - k.price) * short, k.amount * k.price * weekMonths);
    transfer(c, k.seller, k.buyer, owed, 'penalties', 'contractIncome');
  }
}

/** A17 for goods and food: a seller that shipped less than its allocations pays Kingsport the difference, capped at 10%. */
function goodsShortfalls(c: CountyState, r: RegionalContext): void {
  const all: readonly Allocation[] = c.snapshot.allocations ?? [];
  if (!all.length) return;
  const p = pp(c);
  const world = worldAt(c.seed, r.month, { startMonth: c.season.startMonth, boomBust: c.season.theme === 'boomBust' }, p);
  const imp = { goods: p.firms.goodsUnit * world.goods * p.firms.goodsImport, food: p.firms.foodBand[1] * world.goods };
  for (let x = 0; x < all.length; x++) {
    const a = all[x];
    if (a.seller >= c.towns.length) continue;
    const s = c.towns[a.seller];
    // A33: no penalty for not shipping to a buyer who has left.
    if (!isActive(s) || a.buyer >= c.towns.length || !isActive(c.towns[a.buyer])) continue;
    const months = monthsToday(c, a.seller);
    if (months <= 0) continue;
    const perMonth = (s.realised.shipped[x] ?? 0) / months;
    const owed = shortfallCharge(a, perMonth, imp[a.good], rp(c).goodsShortfallCap) * months;
    payKingsport(c, a.seller, owed, 'penalties');
  }
}

/**
 * Shared-place fees: the partner pays each provider per patient- or
 * student-month of that agreement's own places it had today (`used`, fixed
 * at yesterday's step 4). An agreement accepted today, or not yet started,
 * has none, so it costs nothing until its places arrive.
 */
function sharedFees(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  for (const s of g.shares) {
    if (s.provider >= c.towns.length || s.user >= c.towns.length || s.startDay > r.dayIndex) continue;
    if (!isActive(c.towns[s.provider]) || !isActive(c.towns[s.user])) continue;
    const used = s.used ?? 0;
    if (!(used > 0)) continue;
    transfer(c, s.user, s.provider, s.price * used * monthsToday(c, s.user), 'contractPayments', 'sharedFees');
  }
}

/** Gift and aid coins reach their town; adverts' fees go to Kingsport, which ran them. */
function deliverCoins(c: CountyState): void {
  const g = regionOf(c);
  for (const d of g.outbox) {
    if ((d.kind !== 'gift' && d.kind !== 'aid') || !(d.amount > 0) || (d.kind === 'aid' && d.item !== 'coins')) continue;
    const ok = d.to < c.towns.length && !c.towns[d.to].archived;
    payFromEscrow(c, ok ? d.to : d.from, d.amount, d.kind === 'gift' ? 'giftCoins' : 'aid');
    d.amount = 0;
  }
}

/** The Development Fund (§8.9): the largest town pays 1.5% of its day's revenue in while it is over 2× the median. */
const TAX_LINES = ['homesTax', 'businessTax', 'salesTax', 'hotelTax', 'fares', 'utilitySales', 'dealLeases', 'tuition'] as const;

export function dayRevenue(t: TownState): number {
  let s = 0;
  for (const l of TAX_LINES) s += Math.max(0, t.books.dayLines[lineIndex(l)] ?? 0);
  return s;
}

function fundContributions(c: CountyState): void {
  const p = pp(c);
  const med = countyMedian(c);
  if (!(med > 0)) return;
  let top = -1;
  let topPop = -1;
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (!isActive(t)) continue;
    const pop = population(t);
    if (pop > topPop) {
      topPop = pop;
      top = i;
    }
  }
  if (top < 0 || !(topPop > p.fairness.fundTrigger * med)) return;
  const amount = Math.round(p.fairness.fundShare * dayRevenue(c.towns[top]));
  if (!(amount > 0)) return;
  const t = c.towns[top];
  postWhole(t, 'fundContribution', -amount);
  c.fund += amount;
  // The giver is the Generous Benefactor: leading feels like civic pride, not a penalty.
  if (!t.trophies.includes('generousBenefactor')) t.trophies.push('generousBenefactor');
}

/**
 * §8.12: a mayor joining a mature county gets 25% of the county median
 * reserves on top of the founding grant (at most £200,000), from Kingsport,
 * at the first Regional Day after founding. Once per town by construction:
 * each town is founded during exactly one day.
 */
function lateJoinerGrants(c: CountyState): void {
  const q = rp(c);
  if (c.dayIndex < q.lateJoinDays) return;
  // Founded before the last Regional Day ran (a move at that very instant comes after it: moves wait while a day is due).
  const others = c.towns.filter((t) => isActive(t) && t.foundedAt < c.lastRegionalDayAt).map((t) => t.money.reserves);
  if (!others.length) return;
  const sorted = [...others].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const grant = Math.round(Math.min(q.lateJoinMax, Math.max(0, q.lateJoinShare * med)));
  if (!(grant > 0)) return;
  for (const t of c.towns) {
    if (t.archived || t.foundedAt < c.lastRegionalDayAt) continue;
    postWhole(t, 'other', grant);
    c.kingsport.treasuryOut += grant;
    note(c, c.towns.indexOf(t), c.dayIndex, 'welcomeGrant', { amount: grant });
  }
}

/** STEP §8.3 2 (WP3): move money, conserved exactly (£ out of A = £ into B, or into escrow, the Fund or Kingsport). */
export function stepMoveMoney(c: CountyState, r: RegionalContext): void {
  regionOf(c);
  lateJoinerGrants(c);
  settleOffers(c, r);
  commuterTransfers(c);
  contractPayments(c);
  goodsShortfalls(c, r);
  sharedFees(c, r);
  payBusServices(c);
  deliverCoins(c);
  // Adverts' fees: Kingsport ran the campaign. One whose target has left
  // never runs (step 4 drops it), so its fee goes back to the advertiser.
  for (const d of regionOf(c).outbox)
    if (d.kind === 'advert' && d.amount > 0) {
      if (d.to < c.towns.length && isActive(c.towns[d.to])) escrowToKingsport(c, d.amount);
      else payFromEscrow(c, d.from, d.amount, 'refunds');
      d.amount = 0;
    }
  fundContributions(c);
}

// ---- Step 6: deliver ------------------------------------------------------------------------------

function note(c: CountyState, i: number, day: number, kind: string, data: Record<string, number | string>, from: number | null = null): void {
  inboxNote(c, i, day, kind, data, from);
}


/** STEP §8.3 6 (WP3): gifts, aid, pranks, adverts and stamps reach their towns' inboxes. */
export function stepDeliver(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  const q = rp(c);
  for (const d of g.outbox) {
    if (d.to >= c.towns.length) continue;
    const to = c.towns[d.to];
    if (to.archived) {
      if (d.kind === 'aid' && d.item === 'goods') c.towns[d.from].goodsStock[0] += d.amount;
      continue;
    }
    if (d.kind === 'gift' || d.kind === 'aid' || d.kind === 'stamp') countKind(c, d.from);
    switch (d.kind) {
      case 'gift':
        note(c, d.to, r.dayIndex, 'gift', { item: d.item }, d.from);
        break;
      case 'aid':
        if (d.item === 'goods') to.goodsStock[0] += d.amount;
        note(c, d.to, r.dayIndex, 'aid', { kind: d.item, amount: d.amount }, d.from);
        break;
      case 'prank':
        note(c, d.to, r.dayIndex, 'prank', { prank: d.item }, d.from);
        break;
      case 'prankReply':
        note(c, d.to, r.dayIndex, 'prankBack', { prank: d.item }, d.from);
        break;
      case 'stamp':
        to.stamps.push({ from: d.from, sticker: d.item, day: r.dayIndex });
        while (to.stamps.length > 20) to.stamps.shift();
        note(c, d.to, r.dayIndex, 'stamp', { sticker: d.item }, d.from);
        break;
      case 'advert': {
        // The advertiser's awareness rises at once; the target sees the billboard and a suggested reply.
        const from = c.towns[d.from];
        if (!from.archived) from.aw = Math.min(1, from.aw + q.advertAwareness);
        note(c, d.to, r.dayIndex, 'billboard', { cohort: Number(d.item) }, d.from);
        break;
      }
      default:
        break;
    }
  }
  g.outbox = [];
}

// ---- Step 7: the year end -------------------------------------------------------------------------

/** Kingsport grows logistically per county month toward 40,000 + 15,000 per active town (§8.1). */
export function growKingsport(c: CountyState, month: number): void {
  const g = regionOf(c);
  const p = pp(c);
  let active = 0;
  for (const t of c.towns) if (isActive(t)) active++;
  const cap = p.kingsport.capBase + p.kingsport.capPerTown * active;
  const months = Math.max(0, Math.min(600, month - g.kingsportMonth));
  let N = c.kingsport.pop;
  for (let m = 0; m < months; m++) N += p.kingsport.growth * N * (1 - N / cap);
  c.kingsport.pop = Math.max(0, Math.round(N));
  g.kingsportMonth = Math.max(g.kingsportMonth, month);
}

/** Did this seat build anything since an instant (the holiday ends on any build, §2.4)? */
function builtSince(c: CountyState, seat: string, since: number): boolean {
  for (let x = c.log.length - 1; x >= 0; x--) {
    const rec = c.log[x];
    if (rec.at < since) break;
    if (rec.seat === seat && rec.type === 'build') return true;
  }
  return false;
}

/** STEP §8.3 7 (WP3): Initiatives, holiday, grace and shield counters, the Improvement sample, the week's samples, Kingsport. */
export function stepYearEnd(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  const p = pp(c);
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) continue;
    // A Mayor's Initiative a day, banked up to 7 (§8.11).
    t.initiatives = Math.min(p.social.initiativeBank, t.initiatives + 1);
    // Holiday ends when its days are up, or on any build since it began (§2.4).
    const from = g.holidayFrom[i];
    if (t.holiday.until !== null && (t.holiday.until <= r.at || (from !== null && builtSince(c, t.seat, from)))) {
      t.holiday.until = null;
      g.holidayFrom[i] = null;
    }
    // Grace and shield are "in force while dayIndex < value": cleared once tomorrow is past them.
    if (t.grace !== null && t.grace <= r.dayIndex + 1) t.grace = null;
    if (t.shield !== null && t.shield <= r.dayIndex + 1) t.shield = null;
    if (!isActive(t)) {
      g.lastTick[i] = t.tick;
      continue;
    }
    // The Improvement score's daily sample: the mean perceived town star (7 kept).
    t.improvement.push(Math.round(meanStar(t) * 100) / 100);
    while (t.improvement.length > 7) t.improvement.shift();
    const pop = population(t);
    g.popDays[i].push(pop);
    while (g.popDays[i].length > 7) g.popDays[i].shift();
    // The County Week's samples (awards are averages over the whole week, never a snapshot).
    const w = g.week[i] ?? (g.week[i] = emptyWeek(t));
    if (w.days === 0) {
      w.pop0 = pop;
      w.culture0 = t.culture;
      w.mood0 = t.civicMemo?.mood ?? 0;
    }
    w.days += 1;
    if (onHoliday(t, r.at)) w.holidayDays += 1;
    const mood = t.civicMemo?.mood ?? 0;
    let happy = 0;
    for (const x of t.happy) happy += x;
    w.mood += mood;
    w.happy += happy / Math.max(1, t.happy.length);
    w.pollution += t.ps / Math.max(1, pop / 1000);
    w.safety += t.perceived[SAFETY] ?? 0;
    w.rep += t.rep;
    w.around += t.perceived[AROUND] ?? 0;
    let rev = 0;
    let spend = 0;
    for (let x = 0; x < LEDGER_LINES.length; x++) {
      const v = t.books.dayLines[x] ?? 0;
      if (v > 0) rev += v;
      else spend -= v;
    }
    w.revenue += rev;
    w.spending += spend;
    w.visitors += (t.realised.visitorsHosted ?? 0) + (t.realised.dayTripsHosted ?? 0);
    w.pop1 = pop;
    w.culture1 = t.culture;
    w.mood1 = mood;
    g.lastTick[i] = t.tick;
  }
  // Kind acts for the Kindest Neighbour award are counted as they land
  // (stepDeliver, and settleOffers for a ribbon attended), since both empty
  // their lists before this step runs.
  growKingsport(c, r.month);
}

/** Friendship weeks (§8.7): each pair in contact this County Week counts one more (step 8 calls it). */
export function countFriendship(c: CountyState): void {
  const g = regionOf(c);
  for (let i = 0; i < MAX_TOWNS; i++)
    for (let j = 0; j < MAX_TOWNS; j++) {
      if (i === j || !g.contact[pair(i, j)]) continue;
      c.friendship[i * 6 + j] = (c.friendship[i * 6 + j] ?? 0) + 1;
    }
  g.contact.fill(0);
}
