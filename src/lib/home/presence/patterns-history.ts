// src/lib/home/presence/patterns-history.ts
//
// Movement patterns, month by month and kept for good. The nightly patterns
// build reads a rolling ninety days; this keeps a small summary of each
// calendar month it covered (hours out, steps, how far each person roams,
// time alone and together, routines), so the page can say what changed since
// last month and, as the months build up, show the seasons and the children
// growing more independent. PURE: `patterns.server.ts` runs the analysis for
// each month and stores what `mergeMonth` returns.
//
// A month is compared with the one before only when both are finished, the
// person was well seen in both, and the same tracker saw them: a switch from
// Life360 to the app changes how many journeys are found, not how anyone moves.
// Hours out are per day at home's end of the map, so a holiday month does not
// read as a month of going out.

import { localClock } from './forecast';
import { categoryLabel, type Category, type PatternsReport } from './patterns';
import { WEEKDAYS } from './habits';

const DAY = 86_400_000;

/** Bump to rebuild every stored month that is still inside the trail window. */
export const HISTORY_VERSION = 1;
/** Months the page shows. The store keeps them all. */
export const HISTORY_SHOWN = 12;
/** Each side of a comparison needs this many seen days at home's end of the map. */
const MIN_LOCAL_DAYS = 10;
const MIN_COVERAGE = 0.5;

export interface MonthPerson {
  subject: string; displayName: string;
  /** The tracker that saw most of the month: 'app' or 'life360'. */
  source: string | null;
  coverage: number; observedDays: number;
  /** Seen days with a stay far from home (holidays), and the seen days without one. */
  awayDays: number; localDays: number;
  /** Hours out a day, over the local days. */
  outPerDay: number | null;
  trips: number; travelHours: number; distanceKm: number;
  roamKm: number; distinctPlaces: number; aloneOutShare: number; predictability: number;
  firstOut: { weekday: string | null; weekend: string | null };
  lastHome: { weekday: string | null; weekend: string | null };
  /** Mean steps a day over the days not far from home, and the days counted in all. */
  steps: number | null; stepDays: number;
  categories: Partial<Record<Category, number>>;
  places: Array<{ name: string; hours: number; visits: number }>;
  routines: Array<{ category: Category; weekday: number; rate: number; hits: number; of: number; usual: string }>;
  /**
   * The evidence a routine is read from: seen days by weekday (Monday first)
   * and, for each kind of place with a few dates, the days by weekday it was
   * visited. A routine fades only when these show the weekdays seen without it.
   */
  weekdays: number[] | null;
  slots: Partial<Record<Category, number[]>>;
}

export interface MonthSummary {
  /** `YYYY-MM`, London. */
  month: string;
  version: number; builtAt: string;
  /** What the trail window covered of the month, and whether the month is over. */
  from: string; to: string; coveredDays: number; monthDays: number; final: boolean;
  people: MonthPerson[];
  /** `localOutHours` leaves out places far from home; months are compared on it. */
  pairs: Array<{ a: string; b: string; outHours: number; homeHours: number; sharedTrips: number; localOutHours: number }>;
  household: { categories: Partial<Record<Category, number>>; outings: number; medianOuting: number | null };
}

export interface PatternsHistory { months: Record<string, MonthSummary> }

export interface MonthChange { subject: string | null; kind: string; text: string; weight: number }

export interface PatternsHistoryView {
  months: MonthSummary[];
  /** The two finished months compared, oldest first; null until there are two. */
  compared: [string, string] | null;
  changes: MonthChange[];
}

export const EMPTY_HISTORY: PatternsHistory = { months: {} };

/** London midnight at the start of a local date. */
export function londonMidnight(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  const c = localClock(t);
  return c.date === date ? t - c.minute * 60_000 : t;
}

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

/** The calendar months (London) that overlap [from, now], oldest first. */
export function monthsTouching(from: number, now: number): Array<{ month: string; start: number; end: number }> {
  const out: Array<{ month: string; start: number; end: number }> = [];
  let [y, m] = localClock(from).date.split('-').map(Number);
  for (;;) {
    const start = londonMidnight(`${monthKey(y, m)}-01`);
    if (start > now) break;
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
    out.push({ month: monthKey(y, m), start, end: londonMidnight(`${monthKey(ny, nm)}-01`) });
    [y, m] = [ny, nm];
  }
  return out;
}

export const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The month's summary from a report built over that month alone. */
export function summariseMonth(
  report: PatternsReport, month: { month: string; start: number; end: number }, now: number, windowFrom: number,
  sources: Map<string, string | null>,
): MonthSummary {
  const from = Math.max(month.start, windowFrom), to = Math.min(month.end, now);
  return {
    month: month.month, version: HISTORY_VERSION, builtAt: new Date(now).toISOString(),
    from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    coveredDays: r1((to - from) / DAY), monthDays: Math.round((month.end - month.start) / DAY), final: now >= month.end,
    people: report.people.map((p) => ({
      subject: p.subject, displayName: p.displayName, source: sources.get(p.subject) ?? null,
      coverage: p.coverage, observedDays: p.observedDays, awayDays: p.awayDays, localDays: p.localDays,
      outPerDay: p.localDays ? r1(p.localAwayHours / p.localDays) : null,
      trips: p.trips, travelHours: p.travelHours, distanceKm: p.distanceKm,
      roamKm: p.roamKm, distinctPlaces: p.distinctPlaces, aloneOutShare: p.aloneOutShare, predictability: p.predictability,
      firstOut: p.firstOut, lastHome: p.lastHome,
      steps: p.steps.localMean, stepDays: p.steps.days,
      categories: Object.fromEntries(p.categories.map((c) => [c.category, c.hours])),
      places: p.places.filter((x) => x.category !== 'home').slice(0, 5).map((x) => ({ name: x.name, hours: x.hours, visits: x.visits })),
      routines: p.habits.routines.slice(0, 6).map((x) => ({ category: x.category, weekday: x.weekday, rate: x.rate, hits: x.hits, of: x.of, usual: x.usual })),
      weekdays: p.habits.week[0]?.days.map((d) => d.of) ?? null,
      slots: Object.fromEntries(p.habits.week.map((w) => [w.category, w.days.map((d) => d.hits)])),
    })),
    pairs: report.together.pairs.map((x) => ({ ...x, localOutHours: x.localOutHours ?? x.outHours })),
    household: {
      categories: Object.fromEntries(report.household.categories.map((c) => [c.category, c.hours])),
      outings: report.household.habits.outings.counted,
      medianOuting: report.household.habits.outings.about?.medianMinutes ?? null,
    },
  };
}

/**
 * Keep a month. A finished month built from all of itself is never replaced
 * by one built from less of it — the window slides past a month's start long
 * after the month was summed — unless the summary's version is older.
 */
export function mergeMonth(history: PatternsHistory, next: MonthSummary): PatternsHistory {
  const had = history.months[next.month];
  const keep = had && had.version >= next.version && had.final && had.coveredDays > next.coveredDays;
  return keep ? history : { months: { ...history.months, [next.month]: next } };
}

/** What changed from one finished month to the next, strongest first. */
export function compareMonths(prev: MonthSummary, cur: MonthSummary): MonthChange[] {
  const out: MonthChange[] = [];
  const [was, now] = [monthName(prev.month), monthName(cur.month)];
  const num = (n: number) => Math.round(n).toLocaleString('en-GB');
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const comparable = (a: MonthPerson | undefined, b: MonthPerson | undefined): a is MonthPerson =>
    !!a && !!b && a.source === b.source && a.coverage >= MIN_COVERAGE && b.coverage >= MIN_COVERAGE
    && a.localDays >= MIN_LOCAL_DAYS && b.localDays >= MIN_LOCAL_DAYS;
  const before = new Map(prev.people.map((p) => [p.subject, p]));
  const same = new Map<string, boolean>();

  for (const p of cur.people) {
    const q = before.get(p.subject);
    if (!comparable(q, p)) continue;
    same.set(p.subject, true);
    const who = p.displayName;
    if (q.outPerDay != null && p.outPerDay != null) {
      const d = p.outPerDay - q.outPerDay;
      if (Math.abs(d) >= 0.75 && Math.abs(d) >= q.outPerDay * 0.25) out.push({ subject: p.subject, kind: 'out', weight: Math.min(0.8, 0.6 + Math.abs(d) / 10),
        text: `${who} was out ${d > 0 ? 'more' : 'less'} in ${now} than in ${was}: ${p.outPerDay} hours a day against ${q.outPerDay}.` });
    }
    if (q.steps != null && p.steps != null && q.stepDays >= MIN_LOCAL_DAYS && p.stepDays >= MIN_LOCAL_DAYS) {
      const d = p.steps - q.steps;
      if (Math.abs(d) >= 800 && Math.abs(d) >= q.steps * 0.15) out.push({ subject: p.subject, kind: 'steps', weight: Math.min(0.8, 0.6 + Math.abs(d) / 20000),
        text: `${who} walked ${d > 0 ? 'more' : 'less'} in ${now}: ${num(p.steps)} steps a day against ${num(q.steps)} in ${was}.` });
    }
    if (q.roamKm > 0 && Math.abs(p.roamKm - q.roamKm) >= 2 && Math.abs(p.roamKm - q.roamKm) >= q.roamKm * 0.4)
      out.push({ subject: p.subject, kind: 'roam', weight: 0.6,
        text: `${who}'s weeks ${p.roamKm > q.roamKm ? 'reached further' : 'stayed closer to home'} in ${now}: a typical radius of ${p.roamKm} km against ${q.roamKm} km.` });
    if (Math.abs(p.aloneOutShare - q.aloneOutShare) >= 0.15)
      out.push({ subject: p.subject, kind: 'alone', weight: 0.65,
        text: `${who} spent ${p.aloneOutShare > q.aloneOutShare ? 'more' : 'less'} of their time out without anyone from home in ${now}: ${pct(p.aloneOutShare)} against ${pct(q.aloneOutShare)}.` });
    // A routine starts or stops only on evidence: the other month saw that
    // weekday four times or more and the place on at most one of them. Not
    // making the other month's top list is not evidence.
    const rareIn = (m: MonthPerson, x: { category: Category; weekday: number }) => {
      const of = m.weekdays?.[x.weekday] ?? 0, hits = m.slots[x.category]?.[x.weekday] ?? 0;
      return of >= 4 && hits <= 1 ? { hits, of } : null;
    };
    for (const x of p.routines) {
      const before = x.rate >= 0.5 && x.hits >= 3 ? rareIn(q, x) : null;
      if (before) out.push({ subject: p.subject, kind: 'new-routine', weight: 0.62,
        text: `New in ${now}: ${who} at ${categoryLabel(x.category).toLowerCase()} on ${WEEKDAYS[x.weekday]}s, ${x.hits} of ${x.of} (${before.hits} of ${before.of} in ${was}), about ${x.usual}.` });
    }
    for (const x of q.routines) {
      const after = x.rate >= 0.6 && x.hits >= 3 ? rareIn(p, x) : null;
      if (after) out.push({ subject: p.subject, kind: 'faded', weight: 0.6,
        text: `${who}'s ${categoryLabel(x.category).toLowerCase()} on ${WEEKDAYS[x.weekday]}s did not hold in ${now}: ${after.hits} of ${after.of}, against ${x.hits} of ${x.of} in ${was}.` });
    }
  }
  // Time together: both people comparable, and enough of it to notice. The
  // two biggest moves only: five pairs of children all "more" is one story.
  const together: Array<MonthChange & { d: number }> = [];
  for (const x of cur.pairs) {
    if (!same.get(x.a) || !same.get(x.b)) continue;
    const y = prev.pairs.find((z) => z.a === x.a && z.b === x.b);
    if (!y || Math.max(x.localOutHours, y.localOutHours) < 5) continue;
    const d = x.localOutHours - y.localOutHours;
    if (Math.abs(d) >= 5 && Math.abs(d) >= Math.max(y.localOutHours, 1) * 0.4) {
      const name = (s: string) => cur.people.find((p) => p.subject === s)?.displayName ?? s;
      together.push({ d: Math.abs(d), subject: null, kind: 'together', weight: 0.62,
        text: `${name(x.a)} and ${name(x.b)} were out together ${d > 0 ? 'more' : 'less'} in ${now}, nearer home: ${r1(x.localOutHours)} hours against ${r1(y.localOutHours)} in ${was}.` });
    }
  }
  out.push(...together.sort((a, b) => b.d - a.d).slice(0, 2).map(({ d: _, ...c }) => c));
  return out.sort((a, b) => b.weight - a.weight);
}

/** What the page shows: the newest months, and the last two finished ones compared. */
export function historyView(history: PatternsHistory): PatternsHistoryView {
  const months = Object.values(history.months).sort((a, b) => a.month.localeCompare(b.month)).slice(-HISTORY_SHOWN);
  const done = months.filter((m) => m.final);
  const [prev, cur] = done.slice(-2);
  return cur ? { months, compared: [prev.month, cur.month], changes: compareMonths(prev, cur) } : { months, compared: null, changes: [] };
}

/** The tracker behind a trail row: the app, or Life360 through Home Assistant (push, poll, gap, backfill). */
export const trackerOf = (source: string | null | undefined) => (source == null ? 'unknown' : source === 'companion' ? 'app' : 'life360');

/** The tracker that saw most of each person's rows. */
export function dominantSources(rows: Array<{ subject: string; source?: string | null }>): Map<string, string | null> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = counts.get(r.subject) ?? new Map<string, number>();
    const s = trackerOf(r.source);
    m.set(s, (m.get(s) ?? 0) + 1);
    counts.set(r.subject, m);
  }
  return new Map([...counts].map(([subject, m]) => [subject, [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null]));
}
