// The Why engine's contract (spec §5.19). Every important number is produced
// with its explanation: the month steps add named terms as they compute, the
// writer keeps each quantity's top three |amount| terms plus the residual,
// and the town stores two monthly records and seven daily ones (the Gazette's
// week). The term registry below is also WP8's checklist: every key needs a
// kid and an adult template in copy/en-GB.json.
//
// Registry order is the packed index, so both lists are append-only.

import { fromBase64, toBase64 } from './codec';
import { COHORTS, LEDGER_LINES, METERS, STARS, type TownState, type WhyWriter } from './types';

export type WhyUnit = 'people' | '£' | 'points' | 'stars' | 'meter' | 'visitors' | 'units' | 'LV';

export interface QuantityDef {
  id: string;
  unit: WhyUnit;
  /** Stored as round(v × scale) in an Int32. */
  scale: number;
  /** Daily records average this quantity over the day's months instead of summing it. */
  mean?: boolean;
}

export interface TermDef {
  key: string;
  /** The quantity it explains, or a family 'prefix.*' (then add() names the member). */
  q: string;
}

const qs: QuantityDef[] = [{ id: 'pop', unit: 'people', scale: 1 }];
for (const k of COHORTS) qs.push({ id: `arrive.${k}`, unit: 'people', scale: 1 }, { id: `depart.${k}`, unit: 'people', scale: 1 });
for (const m of METERS) qs.push({ id: `meter.${m}`, unit: 'meter', scale: 100, mean: true });
qs.push({ id: 'revenue', unit: '£', scale: 1 }, { id: 'spending', unit: '£', scale: 1 });
for (const l of LEDGER_LINES) qs.push({ id: `line.${l}`, unit: '£', scale: 1 });
for (const k of COHORTS) qs.push({ id: `happy.${k}`, unit: 'stars', scale: 100, mean: true });
qs.push(
  { id: 'approval', unit: 'stars', scale: 100, mean: true },
  { id: 'visitors', unit: 'visitors', scale: 1 },
  { id: 'goodsNet', unit: 'units', scale: 10 },
  { id: 'commutersNet', unit: 'people', scale: 1 },
  { id: 'safety', unit: 'stars', scale: 100, mean: true },
  // On demand (an inspected cell or tile), not stored in the rings.
  { id: 'lv', unit: 'LV', scale: 100 },
  { id: 'grow', unit: 'meter', scale: 100 },
);
export const QUANTITIES: readonly QuantityDef[] = qs;

const ts: TermDef[] = [];
const add = (q: string, ...keys: string[]) => keys.forEach((key) => ts.push({ key, q }));
// Population change (WP2b, WP2e carts, WP3 players).
add('pop', 'pop.births', 'pop.deaths', 'pop.arrivals', 'pop.leavers', 'pop.playersIn', 'pop.playersOut', 'pop.carts', 'pop.displaced', 'pop.other');
// Migration: one term per star and bonus, for each cohort's arrivals and departures (log-share split).
for (const s of STARS) add('arrive.*', `mig.in.${s}`);
add('arrive.*', 'mig.in.needs', 'mig.in.homeGrown', 'mig.in.gem', 'mig.in.fresh', 'mig.in.twin', 'mig.in.advert', 'mig.in.world', 'mig.in.housing', 'mig.in.cap', 'mig.in.carts', 'mig.in.base');
for (const s of STARS) add('depart.*', `mig.out.${s}`);
add('depart.*', 'mig.out.needs', 'mig.out.unhappy', 'mig.out.squeezed', 'mig.out.unemployed', 'mig.out.retier', 'mig.out.uphill', 'mig.out.world', 'mig.out.cap', 'mig.out.base');
// Homes meters (WP2b) and business meters (WP2c).
add('meter.homes*', 'meter.homes.waiting', 'meter.homes.pipeline', 'meter.homes.vacancy', 'meter.homes.needs', 'meter.homes.unreachable', 'meter.homes.squeezed', 'meter.homes.aspirants');
add('meter.*', 'meter.biz.margin', 'meter.biz.unfilled', 'meter.biz.labour', 'meter.biz.bootstrap', 'meter.biz.tax', 'meter.biz.wages', 'meter.biz.rent', 'meter.biz.inputs', 'meter.biz.demand', 'meter.biz.unreachable', 'meter.biz.policy');
// Money: each ledger line is a term of revenue or spending (WP2d), and lines have their own breakdowns.
for (const l of LEDGER_LINES) add('*', `money.${l}`);
add('line.*', 'line.tier.L', 'line.tier.M', 'line.tier.H', 'line.base', 'line.rate', 'line.funding', 'line.scale');
// Happiness and approval (WP2d).
for (const s of STARS) add('happy.*', `happy.${s}`);
add('happy.*', 'happy.needs', 'happy.overcrowding', 'happy.overqualified', 'happy.irritation');
add('approval', 'approval.mood', 'approval.checklist', 'approval.tax');
// Visitors (WP2c), goods (WP2c), commuters (WP2b), safety (WP2a).
add('visitors', 'vis.attractions', 'vis.quality', 'vis.reputation', 'vis.awareness', 'vis.hotelTax', 'vis.beds', 'vis.season', 'vis.world', 'vis.satisfaction', 'vis.dayTrips', 'vis.overflow');
add('goodsNet', 'goods.production', 'goods.use', 'goods.allocIn', 'goods.allocOut', 'goods.export', 'goods.import', 'goods.construction');
add('commutersNet', 'comm.in', 'comm.out');
add('safety', 'safety.unemployment', 'safety.inequality', 'safety.density', 'safety.fun', 'safety.education', 'safety.youth', 'safety.police', 'safety.policy', 'safety.landValue');
// On demand: land value at a cell (§5.7) and a tile's growth score (§5.2).
add('lv', 'lv.base', 'lv.jobs', 'lv.nature', 'lv.school', 'lv.health', 'lv.culture', 'lv.transit', 'lv.scenic', 'lv.premium', 'lv.pollution', 'lv.noise', 'lv.crime', 'lv.bonus', 'lv.potholes', 'lv.rateCap');
add('grow', 'grow.meter', 'grow.desirability', 'grow.unpowered', 'grow.dry', 'grow.noRoad', 'grow.levelCap', 'grow.landValue', 'grow.builders');
export const TERMS: readonly TermDef[] = ts;

const Q_INDEX: Record<string, number> = {};
QUANTITIES.forEach((q, i) => (Q_INDEX[q.id] = i));
const T_INDEX: Record<string, number> = {};
TERMS.forEach((t, i) => (T_INDEX[t.key] = i));

export const quantityIndex = (id: string): number => Q_INDEX[id] ?? -1;
export const termIndex = (key: string): number => T_INDEX[key] ?? -1;

/** Does term `key` explain quantity `q`? ('*' families match by prefix.) */
export function termFits(def: TermDef, q: string): boolean {
  if (def.q === '*') return true;
  if (def.q.endsWith('*')) return q.startsWith(def.q.slice(0, -1));
  return def.q === q;
}

/** The default quantity for a term (its own, or the money line's revenue/spending total). */
function defaultQuantity(def: TermDef, amount: number): string | null {
  if (def.key.startsWith('money.')) return amount >= 0 ? 'revenue' : 'spending';
  if (def.q.includes('*')) return null;
  return def.q;
}

// ---- The writer -------------------------------------------------------------------------

export interface WhyEntry {
  q: string;
  v: number;
  terms: [key: string, amount: number][];
  rest: number;
}

export interface WhyRecord {
  /** County month (monthly records) or dayIndex (daily records). */
  at: number;
  /** Months folded into a daily record. */
  months: number;
  entries: WhyEntry[];
}

export class MonthWhy implements WhyWriter {
  /** Per quantity index: term sums by term index. */
  private readonly sums = new Map<number, Map<number, number>>();
  private readonly values = new Map<number, number>();
  /** Unknown keys or mismatched quantities, kept for tests (the writer never throws mid-month). */
  readonly problems: string[] = [];

  add(key: string, amount: number, quantity?: string): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    const ti = T_INDEX[key];
    if (ti === undefined) {
      this.problems.push(`unknown Why term ${key}`);
      return;
    }
    const def = TERMS[ti];
    const q = quantity ?? defaultQuantity(def, amount);
    if (q === null || !termFits(def, q) || Q_INDEX[q] === undefined) {
      this.problems.push(`term ${key} cannot explain ${String(q)}`);
      return;
    }
    const qi = Q_INDEX[q];
    let m = this.sums.get(qi);
    if (!m) this.sums.set(qi, (m = new Map()));
    m.set(ti, (m.get(ti) ?? 0) + amount);
  }

  set(quantity: string, v: number): void {
    const qi = Q_INDEX[quantity];
    if (qi === undefined) {
      this.problems.push(`unknown Why quantity ${quantity}`);
      return;
    }
    if (Number.isFinite(v)) this.values.set(qi, v);
  }

  /** The month's entries in quantity order: top three |amount| terms (ties by registry index) and the residual. */
  entries(): WhyEntry[] {
    const out: WhyEntry[] = [];
    const qis = new Set<number>([...this.sums.keys(), ...this.values.keys()]);
    for (const qi of [...qis].sort((a, b) => a - b)) {
      const m = this.sums.get(qi);
      const terms = m ? [...m.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0] - b[0]) : [];
      let all = 0;
      for (const [, a] of terms) all += a;
      const v = this.values.has(qi) ? this.values.get(qi)! : all;
      const top = terms.slice(0, 3);
      let topSum = 0;
      for (const [, a] of top) topSum += a;
      out.push({ q: QUANTITIES[qi].id, v, terms: top.map(([ti, a]) => [TERMS[ti].key, a]), rest: v - topSum });
    }
    return out;
  }
}

// ---- Storage: base64 of [version, monthly count, daily count] + today + records --------------

const MONTHLY_KEEP = 2;
/** The stored format's version byte. A string in an older format reads as empty (no stored room predates it). */
const WHY_FORMAT = 2;
const DAILY_KEEP = 7;

interface WhyRings {
  today: WhyRecord;
  monthly: WhyRecord[];
  daily: WhyRecord[];
}

function i32(x: number): number {
  const r = Math.round(x);
  return r > 2147483647 ? 2147483647 : r < -2147483648 ? -2147483648 : r;
}

class Bytes {
  readonly b: number[] = [];
  u8(x: number) {
    this.b.push(x & 255);
  }
  /** Unsigned LEB128: one byte below 128, so small indices and counts cost a byte. */
  uv(x: number) {
    let v = x >>> 0;
    while (v >= 128) {
      this.b.push((v & 127) | 128);
      v >>>= 7;
    }
    this.b.push(v);
  }
  /** A signed i32 as a zigzag varint: most Why amounts are small, so most take one to three bytes. */
  sv(x: number) {
    const v = i32(x);
    this.uv((v << 1) ^ (v >> 31));
  }
}

class Reader {
  o: number;
  constructor(
    readonly b: Uint8Array,
    o: number,
  ) {
    this.o = o;
  }
  u8(): number {
    return this.b[this.o++];
  }
  uv(): number {
    let v = 0;
    let mul = 1;
    for (;;) {
      const c = this.b[this.o++];
      if (c === undefined) throw new Error('Why record ends early');
      v += (c & 127) * mul;
      if (c < 128) return v >>> 0;
      mul *= 128;
    }
  }
  sv(): number {
    const z = this.uv();
    return (z >>> 1) ^ -(z & 1);
  }
}

// Format 2 (review amendment, room size §10.8): varints instead of fixed
// u16/i32 fields roughly halves the stored Why. Format 1 is no longer written.
function writeRecord(w: Bytes, r: WhyRecord): void {
  w.sv(r.at);
  w.uv(r.months);
  w.uv(r.entries.length);
  for (const e of r.entries) {
    const qi = Q_INDEX[e.q];
    const sc = QUANTITIES[qi].scale;
    w.uv(qi);
    w.u8(e.terms.length);
    w.sv(e.v * sc);
    // The residual is not stored: it is the value less the stored terms, so
    // reading it back from the rounded numbers keeps v = Σ terms + rest exact.
    for (const [k, a] of e.terms) {
      w.uv(T_INDEX[k]);
      w.sv(a * sc);
    }
  }
}

function readRecord(r: Reader): WhyRecord {
  const rec: WhyRecord = { at: r.sv(), months: r.uv(), entries: [] };
  const n = r.uv();
  for (let i = 0; i < n; i++) {
    const q = QUANTITIES[r.uv()];
    const nt = r.u8();
    const vi = r.sv();
    let restI = vi;
    const terms: [string, number][] = [];
    for (let j = 0; j < nt; j++) {
      const key = TERMS[r.uv()].key;
      const a = r.sv();
      restI -= a;
      terms.push([key, a / q.scale]);
    }
    rec.entries.push({ q: q.id, v: vi / q.scale, terms, rest: restI / q.scale });
  }
  return rec;
}

const emptyRecord = (at: number): WhyRecord => ({ at, months: 0, entries: [] });

export function readWhy(t: TownState): WhyRings {
  if (!t.why) return { today: emptyRecord(-1), monthly: [], daily: [] };
  const b = fromBase64(t.why);
  if (b[0] !== WHY_FORMAT) return { today: emptyRecord(-1), monthly: [], daily: [] };
  const at = new Reader(b, 3);
  const nm = b[1];
  const nd = b[2];
  const today = readRecord(at);
  const monthly: WhyRecord[] = [];
  for (let i = 0; i < nm; i++) monthly.push(readRecord(at));
  const daily: WhyRecord[] = [];
  for (let i = 0; i < nd; i++) daily.push(readRecord(at));
  return { today, monthly, daily };
}

function writeWhy(t: TownState, r: WhyRings): void {
  const w = new Bytes();
  w.u8(WHY_FORMAT);
  w.u8(r.monthly.length);
  w.u8(r.daily.length);
  writeRecord(w, r.today);
  for (const m of r.monthly) writeRecord(w, m);
  for (const d of r.daily) writeRecord(w, d);
  t.why = toBase64(Uint8Array.from(w.b));
}

/** Quantities that live in the rings (on-demand ones are not stored). */
const ON_DEMAND = new Set(['lv', 'grow']);

/**
 * Month end: stores the month's record (newest last, two kept) and folds it
 * into today's running record, which the Regional Day closes (foldWhyDay).
 */
export function commitWhy(t: TownState, why: MonthWhy, month: number): void {
  const rings = readWhy(t);
  const entries = why.entries().filter((e) => !ON_DEMAND.has(e.q));
  const rec: WhyRecord = { at: month, months: 1, entries };
  rings.monthly.push(roundTrip(rec));
  while (rings.monthly.length > MONTHLY_KEEP) rings.monthly.shift();
  rings.today = mergeRecord(rings.today, rec);
  writeWhy(t, rings);
}

/** Regional Day: closes today's record into the daily ring (seven kept). */
export function foldWhyDay(t: TownState, dayIndex: number): void {
  const rings = readWhy(t);
  const today = rings.today;
  if (today.months > 0) {
    const daily: WhyRecord = { at: dayIndex, months: today.months, entries: today.entries.map((e) => meanIfNeeded(e, today.months)) };
    rings.daily.push(daily);
    while (rings.daily.length > DAILY_KEEP) rings.daily.shift();
  }
  rings.today = emptyRecord(-1);
  writeWhy(t, rings);
}

function meanIfNeeded(e: WhyEntry, months: number): WhyEntry {
  if (!QUANTITIES[Q_INDEX[e.q]].mean || months <= 1) return e;
  return { q: e.q, v: e.v / months, rest: e.rest / months, terms: e.terms.map(([k, a]) => [k, a / months]) };
}

/** Sums two records entry by entry; the top three are recomputed from the summed terms. */
function mergeRecord(a: WhyRecord, b: WhyRecord): WhyRecord {
  const byQ = new Map<string, { v: number; terms: Map<string, number>; rest: number }>();
  for (const r of [a, b])
    for (const e of r.entries) {
      let x = byQ.get(e.q);
      if (!x) byQ.set(e.q, (x = { v: 0, terms: new Map(), rest: 0 }));
      x.v += e.v;
      for (const [k, amt] of e.terms) x.terms.set(k, (x.terms.get(k) ?? 0) + amt);
      x.rest += e.rest;
    }
  const entries: WhyEntry[] = [];
  for (const q of [...byQ.keys()].sort((p, r) => Q_INDEX[p] - Q_INDEX[r])) {
    const x = byQ.get(q)!;
    const sorted = [...x.terms.entries()].sort((p, r) => Math.abs(r[1]) - Math.abs(p[1]) || T_INDEX[p[0]] - T_INDEX[r[0]]);
    const top = sorted.slice(0, 3);
    let topSum = 0;
    for (const [, amt] of top) topSum += amt;
    entries.push({ q, v: x.v, terms: top, rest: x.v - topSum });
  }
  return roundTrip({ at: b.at, months: a.months + b.months, entries });
}

/** Applies the storage scaling so merged and stored records agree exactly. */
function roundTrip(r: WhyRecord): WhyRecord {
  const w = new Bytes();
  writeRecord(w, r);
  return readRecord(new Reader(Uint8Array.from(w.b), 0));
}
