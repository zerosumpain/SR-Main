// Three layers of one truth (spec §9.6), as data for whoever draws them:
//   - Mood: the wants bubbles on the map (at most 3), placed over the part of
//     town the want is about; the mood face and the five faces.
//   - Why: the top three causes, with amounts, of any number the month step
//     explained (the Why rings, §5.19).
//   - Ledger: the month's budget by line and the cohort table (adults, from
//     Town).
// In the app SwiftUI draws the chrome from the wire; the page draws the
// bubbles, and harness mode draws everything from these functions.

import {
  B_KIND,
  BUILDINGS,
  CAT_ZONE,
  FACES,
  LEDGER_LINES,
  MAP,
  TILES,
  Z_HOMES,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  facesOf,
  lvlLevel,
  lvlTier,
  planesOf,
  readWhy,
  tileIndex,
  useCat,
  usePayload,
  type MeWire,
  type TownState,
  type WhyEntry,
} from './engine';
import { words, type CopyLevel } from './copy';
import { signed } from './format';

export type Derived = NonNullable<MeWire['derived']>;

// ---- Mood --------------------------------------------------------------------------------------------

export interface Bubble {
  key: string;
  label: string;
  x: number;
  y: number;
  severity: number;
  hatched: boolean;
}

const WANT_WORDS: Record<string, string> = {
  homes: 'More homes, please',
  shops: 'Shops, please',
  factories: 'Factory jobs, please',
  offices: 'Offices, please',
  hotels: 'Somewhere to stay',
  power: 'Power, please',
  water: 'Water, please',
};
const MONEY = ['£', '££', '£££'];

/** A want key in words: WP8's copy first, these plain fallbacks for keys it lacks. */
export function wantLabel(key: string, derived: Derived | null = null, level: CopyLevel = 'adult'): string {
  const said = words(`want.${key}`, level, {}, '');
  if (said) return said;
  if (WANT_WORDS[key]) return WANT_WORDS[key];
  if (key.startsWith('needs.')) {
    const h = Number(key.slice(6));
    const row = derived?.needs.find((r) => r.tier === h);
    const missing = row?.items.find((it) => it.met < 0.5);
    return `${MONEY[h] ?? ''} families would love ${missing ? `a ${missing.key}` : 'more nearby'}`;
  }
  if (key.startsWith('talk.')) return `Talk: ${key.slice(5)}`;
  return key;
}

const ZONE_OF_WANT: Record<string, number> = { homes: Z_HOMES, shops: Z_SHOPS, factories: Z_INDUSTRY, offices: Z_OFFICES, hotels: Z_LEISURE };

/** The middle of the tiles matching `test`, snapped to the matching tile nearest it (or null). */
function centreOf(test: (i: number) => boolean): [number, number] | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < TILES; i++)
    if (test(i)) {
      n++;
      sx += i % MAP;
      sy += Math.floor(i / MAP);
    }
  if (!n) return null;
  const cx = sx / n;
  const cy = sy / n;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < TILES; i++) {
    if (!test(i)) continue;
    const d = (i % MAP - cx) ** 2 + (Math.floor(i / MAP) - cy) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return [best % MAP, Math.floor(best / MAP)];
}

function townHallTile(t: TownState): [number, number] {
  const hall = t.buildings.find((b) => BUILDINGS[b[B_KIND]]?.id === 'townHall');
  return hall ? [hall[1], hall[2]] : [32, 44];
}

/** Up to three wants bubbles, each over the part of town it is about (§9.2). */
export function wantsBubbles(t: TownState, derived: Derived | null, level: CopyLevel = 'adult'): Bubble[] {
  if (!derived) return [];
  const p = planesOf(t);
  const used = new Set<number>();
  const out: Bubble[] = [];
  for (const w of derived.wants.slice(0, 3)) {
    let at: [number, number] | null = w.tile >= 0 ? [w.tile % MAP, Math.floor(w.tile / MAP)] : null;
    const zone = ZONE_OF_WANT[w.key];
    if (!at && zone !== undefined) at = centreOf((i) => useCat(p.use[i]) === CAT_ZONE && usePayload(p.use[i]) === zone);
    if (!at && w.key.startsWith('needs.')) {
      const h = Number(w.key.slice(6));
      at = centreOf((i) => useCat(p.use[i]) === CAT_ZONE && usePayload(p.use[i]) === Z_HOMES && lvlLevel(p.lvl[i]) > 0 && lvlTier(p.lvl[i]) === h);
    }
    at ??= townHallTile(t);
    // Two bubbles never sit on one tile: nudge along the row.
    let [x, y] = at;
    while (used.has(tileIndex(x, y)) && x < MAP - 1) x++;
    used.add(tileIndex(x, y));
    out.push({ key: w.key, label: wantLabel(w.key, derived, level), x, y, severity: w.severity, hatched: w.hatched });
  }
  return out;
}

const FACE_WORDS = ['very unhappy', 'unhappy', 'okay', 'happy', 'very happy'];

/** A mood number (0–100) in words. */
export function moodWords(v: number): string {
  return FACE_WORDS[v < 30 ? 0 : v < 45 ? 1 : v < 60 ? 2 : v < 75 ? 3 : 4];
}

/** The town's mood: population-weighted happiness over every cohort. */
export function townMood(t: TownState): number {
  const n = facesOf(t);
  const total = n.reduce((a, b) => a + b, 0);
  if (!total) return t.happy.length ? t.happy.reduce((a, b) => a + b, 0) / t.happy.length : 50;
  let s = 0;
  let w = 0;
  // Cohort happiness weighted by people (cohorts: Workers, Families, Retirees per tier, Students).
  for (let h = 0; h < 3; h++)
    for (let kind = 0; kind < 3; kind++) {
      const k = h * 3 + kind;
      const persons = kind === 0 ? t.people[h] : kind === 1 ? t.people[3 + h] + t.people[6 + h] : t.people[9 + h];
      s += persons * (t.happy[k] ?? 50);
      w += persons;
    }
  s += t.people[12] * (t.happy[9] ?? 50);
  w += t.people[12];
  return w ? s / w : 50;
}

export interface FaceRow {
  face: (typeof FACES)[number];
  people: number;
  /** Mean stars 0–5 in halves. */
  stars: number;
}

/** The five faces with people and stars (§9.6 Mood). */
export function faceRows(t: TownState): FaceRow[] {
  const n = facesOf(t);
  const stars = t.perceived.slice(0, 11);
  const mean = stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : 50;
  return FACES.map((face, k) => ({ face, people: n[k], stars: Math.round((mean / 20) * 2) / 2 }));
}

// ---- Why ---------------------------------------------------------------------------------------------

export interface WhyLine {
  quantity: string;
  value: number;
  /** Top three causes, largest first, with their amounts. */
  causes: [key: string, amount: number][];
  rest: number;
}

/** The latest month's explanation of `quantity` (e.g. 'pop', 'revenue', 'meter.shops', 'happy.fL'), or null. */
export function whyOf(t: TownState, quantity: string): WhyLine | null {
  const rings = readWhy(t);
  const rec = rings.monthly[rings.monthly.length - 1];
  const e: WhyEntry | undefined = rec?.entries.find((x) => x.q === quantity);
  if (!e) return null;
  const causes = [...e.terms].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
  return { quantity, value: e.v, causes, rest: e.rest };
}

/** "+40 near jobs · −22 smoke": a cause list in one line. */
export function causeLine(w: WhyLine | null, words: (key: string) => string = (k) => k.replace(/^[a-z]+\./, '')): string {
  if (!w || !w.causes.length) return 'Nothing to explain yet: wait for pay day.';
  return w.causes.map(([k, v]) => `${signed(v)} ${words(k)}`).join(' · ');
}

// ---- Ledger ------------------------------------------------------------------------------------------

export interface LedgerRow {
  line: string;
  amount: number;
}

/** Last month's budget by line (revenue positive, spending negative), from the Why rings. */
export function ledgerRows(t: TownState): { revenue: LedgerRow[]; spending: LedgerRow[]; net: number } {
  const rings = readWhy(t);
  const rec = rings.monthly[rings.monthly.length - 1];
  const rows: LedgerRow[] = [];
  for (const l of LEDGER_LINES) {
    const e = rec?.entries.find((x) => x.q === `line.${l}`);
    if (e && e.v !== 0) rows.push({ line: l, amount: e.v });
  }
  const revenue = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const spending = rows.filter((r) => r.amount < 0).sort((a, b) => a.amount - b.amount);
  return { revenue, spending, net: rows.reduce((a, r) => a + r.amount, 0) };
}

/** The 13-stock cohort table, as (label, persons) rows. */
export function cohortTable(t: TownState): [string, number][] {
  const stage = ['Workers', 'Parents', 'Children', 'Retirees'];
  const out: [string, number][] = [];
  for (let s = 0; s < 4; s++) for (let h = 0; h < 3; h++) out.push([`${stage[s]} ${MONEY[h]}`, t.people[s * 3 + h]]);
  out.push(['Students', t.people[12]]);
  return out;
}

