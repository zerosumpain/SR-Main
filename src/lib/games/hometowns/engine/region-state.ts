// The county layer's shared helpers (WP3): its memory on CountyState.region,
// who takes part in settlement, travel times between towns, the months a
// town ran since the last Regional Day, and the only sanctioned ways WP3
// moves money between towns, escrow and Kingsport.
//
// Money across the county is conserved by construction. Every pound WP3
// moves is one of:
//   - a transfer: the same whole number leaves one town and reaches another;
//   - escrow: a sender's move pays into `region.held` (its own reserves, at
//     the move), and a Regional Day pays it on, refunds it or hands it to
//     Kingsport;
//   - the Development Fund (`county.fund`);
//   - Kingsport: the outside world, recorded in kingsport.treasuryOut (what
//     towns have received from outside, net).
// So Σ reserves + held + fund − treasuryOut is unchanged by anything WP3
// does (countyMoney below; the tests check it across whole Regional Days).

import { gridTickAt } from './clock';
import { population, postWhole } from './core';
import { LINKS } from './content';
import { paramsFor } from './params';
import { regionParams, type RegionParams } from './region-params';
import type { CountyState, LedgerLine, Link, RegionState, TownState, WeekTown } from './types';

export const MAX_TOWNS = 6;
export const pair = (i: number, j: number): number => i * MAX_TOWNS + j;

export function emptyWeek(t?: TownState): WeekTown {
  const pop = t ? population(t) : 0;
  const mood = t?.civicMemo?.mood ?? 0;
  return {
    days: 0,
    holidayDays: 0,
    mood: 0,
    happy: 0,
    pollution: 0,
    safety: 0,
    rep: 0,
    around: 0,
    revenue: 0,
    spending: 0,
    kind: 0,
    visitors: 0,
    pop0: pop,
    pop1: pop,
    culture0: t?.culture ?? 0,
    culture1: t?.culture ?? 0,
    mood0: mood,
    mood1: mood,
  };
}

/** The county layer's memory, created on first use and grown to the town count. */
export function regionOf(c: CountyState): RegionState {
  const rp = regionParams(c.paramsVersion);
  if (!c.region) {
    c.region = {
      held: 0,
      outbox: [],
      lastTick: [],
      lossDays: [],
      popDays: [],
      commute: [],
      stories: [],
      weekStories: [],
      shares: [],
      campaigns: [],
      commuterRule: rp.commuterRuleDefault,
      cleanAir: false,
      countyTrail: false,
      festivalTheme: 'concert',
      flag: 0,
      nextTheme: null,
      greatWorkChoice: null,
      seasonWeek: 0,
      lastWeekDay: -1,
      week: [],
      adverts: new Array<number>(MAX_TOWNS * MAX_TOWNS).fill(0),
      pranks: new Array<number>(MAX_TOWNS * MAX_TOWNS).fill(0),
      contact: new Array<number>(MAX_TOWNS * MAX_TOWNS).fill(0),
      bids: [],
      settled: [],
      erased: [],
      seq: [],
      holidayFrom: [],
      festivalWeekend: null,
      kingsportMonth: c.season.startMonth,
      usual: [],
      leader: -1,
    };
  }
  const g = c.region;
  for (let i = g.lastTick.length; i < c.towns.length; i++) {
    const t = c.towns[i];
    // The town's tick at the last Regional Day (its months since then are today's).
    const atLast = t.gridBase === null || c.lastRegionalDayAt <= 0 ? t.tick : gridTickAt(c, c.lastRegionalDayAt) - t.gridBase;
    g.lastTick.push(Math.max(0, Math.min(t.tick, atLast)));
    g.lossDays.push([]);
    g.popDays.push([]);
    g.week.push(emptyWeek(t));
    g.bids.push('');
    g.holidayFrom.push(null);
    g.usual.push(0);
  }
  if (!g.seq) g.seq = [];
  while (g.seq.length < c.towns.length) g.seq.push(0);
  return g;
}

/** The next serial number for town i's ids (RegionState.seq). */
export function nextSeq(c: CountyState, i: number): number {
  const g = regionOf(c);
  const n = g.seq[i] ?? 0;
  g.seq[i] = n + 1;
  return n;
}

/**
 * An id for something town i made or received: the kind and a serial number
 * of the town's own, so it is unique for the town's life (an inbox that has
 * hit its cap, or a move id used again, cannot make two the same) and it
 * depends only on that town's own history, not on how other towns' moves
 * interleaved with it.
 */
export function idFor(c: CountyState, kind: string, i: number): string {
  return `${kind}.${i}.${nextSeq(c, i)}`;
}

/** A kind act reached another town (a gift, aid, a stamp, a ribbon attended): one more for the sender's Kindest Neighbour score. */
export function countKind(c: CountyState, from: number): void {
  const w = regionOf(c).week[from];
  if (w) w.kind += 1;
}

/** One item into town i's inbox (a ring of 40); nothing reaches an archived town. */
export function inboxNote(c: CountyState, i: number, day: number, kind: string, data: Record<string, number | string>, from: number | null): void {
  const t = c.towns[i];
  if (!t || t.archived) return;
  t.inbox.push({ id: `${kind}.${day}.${nextSeq(c, i)}`, kind, day, from, data });
  while (t.inbox.length > 40) t.inbox.shift();
}

/** On the grid and not archived: takes part in settlement (a town in its fortnight does not, §2.3). */
export function isActive(t: TownState): boolean {
  return !t.archived && t.gridBase !== null;
}

/** Holiday in force at an instant (§2.4). */
export function onHoliday(t: TownState, at: number): boolean {
  return t.holiday.until !== null && at < t.holiday.until;
}

/** The Fresh Town grace in force on a Regional Day (§8.12: 21 days, no outbound to players). */
export function inGrace(t: TownState, dayIndex: number): boolean {
  return t.grace !== null && dayIndex < t.grace;
}

/** Community Spirit in force on a Regional Day (§8.4 item 5). */
export function shielded(t: TownState, dayIndex: number): boolean {
  return t.shield !== null && dayIndex < t.shield;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The county median population over active towns (A15, A33: not Kingsport, not archived). */
export function countyMedian(c: CountyState): number {
  const pops: number[] = [];
  for (const t of c.towns) if (isActive(t)) pops.push(population(t));
  return median(pops);
}

/** Month steps a town ran since the last Regional Day (46–50 ticks across a clock change, §2.2). */
export function monthsToday(c: CountyState, i: number): number {
  const g = regionOf(c);
  const t = c.towns[i];
  const before = g.lastTick[i] ?? t.tick;
  return Math.max(0, Math.floor(t.tick / 4) - Math.floor(before / 4));
}

// ---- Links and travel ----------------------------------------------------------------------

/** Ring neighbours share a facing signpost; anyone else meets via Kingsport (§8.2). */
export function ringNeighbours(c: CountyState, i: number, j: number): boolean {
  const n = c.sites.length;
  const d = Math.abs(c.towns[i].site - c.towns[j].site);
  return d === 1 || d === n - 1;
}

/** The link's own minutes for a pair (§8.2: 25 to a neighbour, 50 via Kingsport; rail 12 / 24). */
export function linkMinutes(c: CountyState, kind: Link['kind'], i: number, j: number): number {
  const def = LINKS.find((l) => l.id === (kind === 'bus' ? 'road' : kind))!;
  return ringNeighbours(c, i, j) ? def.minutesNeighbour : def.minutesVia;
}

export interface PairLink {
  /** Door-to-door minutes t_ij (§8.2), Infinity when not linked. */
  minutes: number;
  /** Trips a day and goods units a month the pair's links carry. */
  trips: number;
  goods: number;
  rail: boolean;
}

/**
 * The open links between every pair: the fastest link's door-to-door time
 * (the link + each town's way to its signpost + 5 minutes at each end;
 * a bus makes the road link's trips 20% shorter), and the capacities of all
 * the pair's open links added up.
 */
export function pairLinks(c: CountyState): PairLink[] {
  const rp = regionParams(c.paramsVersion);
  const n = c.towns.length;
  const out: PairLink[] = [];
  for (let k = 0; k < n * n; k++) out.push({ minutes: Infinity, trips: 0, goods: 0, rail: false });
  for (const l of c.links) {
    if (l.state !== 'open' && l.state !== 'closing') continue;
    if (l.a >= n || l.b >= n) continue;
    const def = LINKS.find((d) => d.id === l.kind);
    if (!def) continue;
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]] as const) {
      const p = out[x * n + y];
      p.trips += def.tripsPerDay;
      p.goods += def.goodsPerMonth;
      if (l.kind === 'rail') p.rail = true;
    }
  }
  for (const l of c.links) {
    if (l.state !== 'open' && l.state !== 'closing') continue;
    if (l.a >= n || l.b >= n || l.kind === 'bus') continue;
    const bus = c.links.some((b) => b.kind === 'bus' && (b.state === 'open' || b.state === 'closing') && ((b.a === l.a && b.b === l.b) || (b.a === l.b && b.b === l.a)));
    const own = l.kind === 'road' && bus ? l.minutes * rp.busTime : l.minutes;
    const door = own + 2 * rp.terminalMinutes + 2 * rp.internalMinutes;
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]] as const) if (door < out[x * n + y].minutes) out[x * n + y].minutes = door;
  }
  return out;
}

// ---- Money ----------------------------------------------------------------------------------------

/** The WP3 money identity (module comment): unchanged by every WP3 step and move. */
export function countyMoney(c: CountyState): number {
  let s = 0;
  for (const t of c.towns) s += t.money.reserves;
  return s + (c.region?.held ?? 0) + c.fund - c.kingsport.treasuryOut;
}

/** Moves a whole number of pounds from town a to town b (both lines posted with the same integer). Returns it. */
export function transfer(c: CountyState, from: number, to: number, amount: number, outLine: LedgerLine, inLine: LedgerLine): number {
  const n = Math.round(amount);
  if (!(n > 0) || from === to) return 0;
  postWhole(c.towns[from], outLine, -n);
  postWhole(c.towns[to], inLine, n);
  return n;
}

/** A town pays Kingsport (the outside world). */
export function payKingsport(c: CountyState, from: number, amount: number, line: LedgerLine): number {
  const n = Math.round(amount);
  if (!(n > 0)) return 0;
  postWhole(c.towns[from], line, -n);
  c.kingsport.treasuryOut -= n;
  return n;
}

/** A sender's move pays into escrow (its own reserves, now). */
export function payIntoEscrow(c: CountyState, from: number, amount: number, line: LedgerLine): number {
  const n = Math.round(amount);
  if (!(n > 0)) return 0;
  postWhole(c.towns[from], line, -n);
  regionOf(c).held += n;
  return n;
}

/** Escrow paid out to a town (a delivery, or a refund). */
export function payFromEscrow(c: CountyState, to: number, amount: number, line: LedgerLine): number {
  const g = regionOf(c);
  const n = Math.min(Math.round(amount), g.held);
  if (!(n > 0)) return 0;
  g.held -= n;
  postWhole(c.towns[to], line, n);
  return n;
}

/** Escrow handed to Kingsport (a link it builds, an advert it runs). */
export function escrowToKingsport(c: CountyState, amount: number): number {
  const g = regionOf(c);
  const n = Math.min(Math.round(amount), g.held);
  if (!(n > 0)) return 0;
  g.held -= n;
  c.kingsport.treasuryOut -= n;
  return n;
}

export function rp(c: CountyState): RegionParams {
  return regionParams(c.paramsVersion);
}

export function pp(c: CountyState) {
  return paramsFor(c.paramsVersion);
}

/** Records contact between two towns this County Week (friendship weeks, §8.7). */
export function touch(c: CountyState, i: number, j: number): void {
  if (i === j || i < 0 || j < 0) return;
  const g = regionOf(c);
  g.contact[pair(i, j)] = 1;
  g.contact[pair(j, i)] = 1;
}
