// src/lib/home/presence/habits.ts
//
// The habits in the visits: what happens on which day at which time of day
// ("shops on a Saturday morning"), what an outing from home looks like (how
// long, how much of it on foot, what goes into it — a park and then
// somewhere to eat), and when in the day each kind of place is visited.
// PURE. `analysePatterns` hands over each person's visits and trips; the
// household's version merges people out together into one outing, so a car
// of four is one trip to the shops, not four.
//
// Nothing is claimed off too few days: a routine needs three dates and a
// rate over the weekdays actually seen; a pairing needs five outings with
// the first kind of place. An outing counts only when the trail saw most of
// it, from leaving home to coming back.

import { circularMedianMinute, hhmm } from './stats';
import type { Trip } from './insights';
import type { Category, Visit } from './patterns';

const MINUTE = 60_000;

export const PARTS = [
  { id: 'early', label: 'early morning', phrase: 'early in the morning', from: 5, to: 9 },
  { id: 'morning', label: 'morning', phrase: 'in the morning', from: 9, to: 12 },
  { id: 'midday', label: 'lunchtime', phrase: 'at lunchtime', from: 12, to: 14 },
  { id: 'afternoon', label: 'afternoon', phrase: 'in the afternoon', from: 14, to: 17 },
  { id: 'evening', label: 'evening', phrase: 'in the evening', from: 17, to: 21 },
  { id: 'night', label: 'night', phrase: 'at night', from: 21, to: 29 },
] as const;
export type Part = (typeof PARTS)[number]['id'];
export const partOf = (minute: number): Part => {
  const h = Math.floor(minute / 60), x = h < 5 ? h + 24 : h;
  return PARTS.find((p) => x >= p.from && x < p.to)!.id;
};
export const partLabel = (p: Part) => PARTS.find((x) => x.id === p)!.label;
export const partPhrase = (p: Part) => PARTS.find((x) => x.id === p)!.phrase;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Not habits worth finding: home is the default, school and work are
 * timetables, and the rest gather unlike places — "other houses" is every
 * residential street the car stopped in, which no two visits share.
 */
const NOT_HABITS: ReadonlySet<Category> = new Set(['home', 'school', 'work', 'unnamed', 'far', 'transport', 'homes', 'other']);
/** An outing longer than this is the trail losing the way home, not a day out. */
const MAX_OUTING_MS = 16 * 60 * MINUTE;
/** Most of an outing must have been seen: at a place or on the move. */
const MIN_OUTING_COVERAGE = 0.6;
/** School or work for this long makes the outing a day's duty, not a trip out. */
const DUTY_MINS = 120;
export const LONG_OUTING_MINS = 180;
const WALK_MINS = 60;

export interface Routine {
  /** A kind of place on a weekday; `part` is the part of the day of its usual arrival. */
  category: Category; weekday: number; part: Part;
  /** Dates it happened on, out of the dates that weekday was seen. */
  hits: number; of: number; rate: number;
  usual: string; places: string[]; people: string[];
}

export interface Outing {
  people: string[]; start: number; end: number; minutes: number; onFoot: number;
  /** The kinds of place in it, in visiting order (a repeat in a row once). */
  stops: Category[]; placeIds: string[];
  kind: 'about' | 'duty' | 'far';
  /** The kind of place that held most of its time. */
  anchor: Category;
  weekday: number; startMin: number;
}

export interface OutingStats {
  anchor: Category | null;
  outings: number; medianMinutes: number; longShare: number;
  medianOnFoot: number; walkShare: number; foodShare: number;
  medianStops: number; starts: string; weekendShare: number;
}

export interface Pairing { a: Category; b: Category; both: number; ofA: number; rate: number; base: number; lift: number }

export interface TimeProfile {
  category: Category; visits: number;
  /** Arrivals by hour of the day, 0–23. */
  hours: number[];
  weekendShare: number;
  /** The two hours that hold the most arrivals, and their share. */
  peak: { from: string; to: string; share: number };
  medianStay: number;
}

export interface Habits {
  routines: Routine[];
  /** Each kind of place across the week: the share of each weekday seen that had it, and when. */
  week: Array<{ category: Category; days: Array<{ hits: number; of: number; rate: number; usual: string | null }> }>;
  outings: { counted: number; about: OutingStats | null; byAnchor: OutingStats[]; pairs: Pairing[]; sequences: Array<{ from: Category; to: Category; n: number }> };
  times: TimeProfile[];
}

const med = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) / 100 : 0);

/**
 * One person's outings: from the end of a stay at home to the start of the
 * next, with every visit between. Only complete outings — left home and came
 * back inside the window — that the trail mostly saw.
 */
export function outingsOf(
  subject: string, visits: Visit[], trips: Trip[], homeId: string | null,
  onFoot: (from: number, to: number) => number, clock: (t: number) => { weekday: number; minute: number },
): Outing[] {
  if (!homeId) return [];
  const sorted = [...visits].sort((a, b) => a.start - b.start);
  const out: Outing[] = [];
  let lastHome: Visit | null = null, inside: Visit[] = [];
  for (const v of sorted) {
    if (v.placeId !== homeId) { if (lastHome) inside.push(v); continue; }
    if (lastHome && inside.length) {
      const start = lastHome.end, end = v.start, minutes = (end - start) / MINUTE;
      const seen = inside.reduce((a, x) => a + x.minutes, 0)
        + trips.filter((t) => t.start >= start - MINUTE && t.end <= end + MINUTE).reduce((a, t) => a + t.minutes, 0);
      if (end - start <= MAX_OUTING_MS && minutes > 0 && seen / minutes >= MIN_OUTING_COVERAGE) {
        const byCat = new Map<Category, number>();
        for (const x of inside) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.minutes);
        const duty = (byCat.get('school') ?? 0) + (byCat.get('work') ?? 0);
        const stops: Category[] = [];
        for (const x of inside) if (stops.at(-1) !== x.category) stops.push(x.category);
        out.push({
          people: [subject], start, end, minutes, onFoot: onFoot(start, end), stops,
          placeIds: [...new Set(inside.map((x) => x.placeId))],
          kind: byCat.has('far') ? 'far' : duty >= DUTY_MINS ? 'duty' : 'about',
          anchor: [...byCat].sort((a, b) => b[1] - a[1])[0][0],
          weekday: clock(start).weekday, startMin: clock(start).minute,
        });
      }
    }
    lastHome = v; inside = [];
  }
  return out;
}

/**
 * People out together are one outing: left within twenty minutes of each
 * other and stayed somewhere in common. The merged outing keeps everyone's
 * stops and the most walking any of them did.
 */
export function mergeOutings(all: Outing[]): Outing[] {
  const merged: Outing[] = [];
  for (const o of [...all].sort((a, b) => a.start - b.start)) {
    const twin = merged.find((m) => Math.abs(m.start - o.start) <= 20 * MINUTE && m.placeIds.some((id) => o.placeIds.includes(id)));
    if (!twin) { merged.push({ ...o, people: [...o.people], stops: [...o.stops], placeIds: [...o.placeIds] }); continue; }
    for (const p of o.people) if (!twin.people.includes(p)) twin.people.push(p);
    for (const id of o.placeIds) if (!twin.placeIds.includes(id)) twin.placeIds.push(id);
    for (const s of o.stops) if (!twin.stops.includes(s)) twin.stops.push(s);
    twin.onFoot = Math.max(twin.onFoot, o.onFoot);
    if (o.minutes > twin.minutes) { twin.minutes = o.minutes; twin.end = o.end; }
  }
  return merged;
}

function statsOf(list: Outing[], anchor: Category | null): OutingStats {
  return {
    anchor, outings: list.length,
    medianMinutes: Math.round(med(list.map((o) => o.minutes))),
    longShare: share(list.filter((o) => o.minutes >= LONG_OUTING_MINS).length, list.length),
    medianOnFoot: Math.round(med(list.map((o) => o.onFoot))),
    walkShare: share(list.filter((o) => o.onFoot >= WALK_MINS).length, list.length),
    foodShare: share(list.filter((o) => o.stops.includes('food')).length, list.length),
    medianStops: med(list.map((o) => o.stops.length)),
    starts: hhmm(circularMedianMinute(list.map((o) => o.startMin))),
    weekendShare: share(list.filter((o) => o.weekday >= 5).length, list.length),
  };
}

/**
 * The habits in a set of visits and outings. `seenDates` is every local date
 * someone in the set was well seen, with its weekday: a routine's rate is over
 * those, so a fortnight away does not read as skipping the shops.
 */
export function habitsOf(
  visits: Visit[], outings: Outing[], seenDates: Map<string, number>,
  name: (placeId: string) => string, displayName: (subject: string) => string,
): Habits {
  // ── Routines ────────────────────────────────────────────────────────────
  const ofWeekday = Array(7).fill(0) as number[];
  for (const wd of seenDates.values()) ofWeekday[wd]++;
  type Slot = { dates: Set<string>; mins: number[]; places: Map<string, number>; people: Set<string> };
  const slots = new Map<string, Slot>();
  for (const v of visits) {
    if (NOT_HABITS.has(v.category) || !seenDates.has(v.date)) continue;
    const k = `${v.category}|${v.weekday}`;
    const s: Slot = slots.get(k) ?? { dates: new Set(), mins: [], places: new Map(), people: new Set() };
    s.dates.add(v.date); s.mins.push(v.arriveMin); s.people.add(v.subject);
    s.places.set(v.placeId, (s.places.get(v.placeId) ?? 0) + 1);
    slots.set(k, s);
  }
  const routines: Routine[] = [];
  for (const [k, s] of slots) {
    const [category, wd] = k.split('|') as [Category, string];
    const weekday = Number(wd), of = ofWeekday[weekday], hits = s.dates.size;
    if (hits < 3 || of < 4 || hits / of < 0.35) continue;
    const usual = circularMedianMinute(s.mins);
    routines.push({
      category, weekday, part: partOf(usual), hits, of, rate: share(hits, of), usual: hhmm(usual),
      places: [...new Set([...s.places].sort((a, b) => b[1] - a[1]).map(([id]) => name(id)))].slice(0, 3),
      people: [...s.people].map(displayName),
    });
  }
  routines.sort((a, b) => b.rate * Math.sqrt(b.hits) - a.rate * Math.sqrt(a.hits));
  const weekCats = new Map<Category, number>();
  for (const [k, s] of slots) { const c = k.split('|')[0] as Category; weekCats.set(c, (weekCats.get(c) ?? 0) + s.dates.size); }
  const week = [...weekCats].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).map(([category]) => ({
    category,
    days: ofWeekday.map((of, wd) => {
      const s = slots.get(`${category}|${wd}`);
      return { hits: s?.dates.size ?? 0, of, rate: share(s?.dates.size ?? 0, of), usual: s ? hhmm(circularMedianMinute(s.mins)) : null };
    }),
  }));

  // ── Outings ─────────────────────────────────────────────────────────────
  const about = outings.filter((o) => o.kind === 'about');
  const byAnchor = new Map<Category, Outing[]>();
  for (const o of about) { const l = byAnchor.get(o.anchor) ?? []; l.push(o); byAnchor.set(o.anchor, l); }
  const anchors = [...byAnchor].filter(([, l]) => l.length >= 3).map(([a, l]) => statsOf(l, a)).sort((a, b) => b.outings - a.outings);

  // What goes with what: of the outings with A, the share that also had B,
  // against B's share of all outings. Lift over 1 is "more likely together".
  const pairs: Pairing[] = [];
  const has = (o: Outing, c: Category) => o.stops.includes(c);
  const cats = [...new Set(about.flatMap((o) => o.stops))].filter((c) => !NOT_HABITS.has(c));
  for (const a of cats) for (const b of cats) {
    if (a === b) continue;
    const withA = about.filter((o) => has(o, a)), both = withA.filter((o) => has(o, b)).length;
    const base = share(about.filter((o) => has(o, b)).length, about.length);
    if (withA.length < 5 || both < 3 || !base) continue;
    const rate = share(both, withA.length);
    pairs.push({ a, b, both, ofA: withA.length, rate, base, lift: Math.round((rate / base) * 10) / 10 });
  }
  pairs.sort((x, y) => y.lift - x.lift || y.both - x.both);

  const seq = new Map<string, number>();
  for (const o of about) for (let i = 1; i < o.stops.length; i++) {
    if (NOT_HABITS.has(o.stops[i - 1]) || NOT_HABITS.has(o.stops[i])) continue;
    const k = `${o.stops[i - 1]}|${o.stops[i]}`; seq.set(k, (seq.get(k) ?? 0) + 1);
  }
  const sequences = [...seq].filter(([, n]) => n >= 3).map(([k, n]) => { const [from, to] = k.split('|') as [Category, Category]; return { from, to, n }; })
    .sort((a, b) => b.n - a.n).slice(0, 8);

  // ── When in the day ─────────────────────────────────────────────────────
  const byCat = new Map<Category, Visit[]>();
  for (const v of visits) {
    if (v.category === 'home' || v.category === 'unnamed') continue;
    const l = byCat.get(v.category) ?? []; l.push(v); byCat.set(v.category, l);
  }
  const times: TimeProfile[] = [];
  for (const [category, list] of byCat) {
    if (list.length < 5) continue;
    const hours = Array(24).fill(0) as number[];
    for (const v of list) hours[Math.floor(v.arriveMin / 60) % 24]++;
    let best = 0, at = 0;
    for (let h = 0; h < 24; h++) { const n = hours[h] + hours[(h + 1) % 24]; if (n > best) { best = n; at = h; } }
    times.push({
      category, visits: list.length, hours,
      weekendShare: share(list.filter((v) => v.weekday >= 5).length, list.length),
      peak: { from: hhmm(at * 60), to: hhmm(((at + 2) % 24) * 60), share: share(best, list.length) },
      medianStay: Math.round(med(list.map((v) => v.minutes))),
    });
  }
  times.sort((a, b) => b.visits - a.visits);

  return {
    routines: routines.slice(0, 12), week,
    outings: { counted: outings.length, about: about.length >= 3 ? statsOf(about, null) : null, byAnchor: anchors.slice(0, 8), pairs: pairs.slice(0, 8), sequences },
    times,
  };
}
