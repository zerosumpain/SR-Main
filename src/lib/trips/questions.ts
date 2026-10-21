// src/lib/trips/questions.ts
//
// v8: quick questions, the pure half. Rule-based generators read the trip,
// its plan and its research pack and DRAFT questions; ./questions.server
// dry-runs every answer and keeps only those whose answers solve to
// different plans ("only ask if the answer changes the plan").
//
//   brief    a stay that misses nights; who is going (when nothing says)
//   tie      two shapes (or day versions) that score within 10 %
//   clash    a must or a booked wish the solver left out; an over-full day
//   research a place that needs booking (deadline = visit day − days
//            ahead); a planned place closed on its day; rain on a day with
//            outdoor stops
//   reaction two turn-downs for the same reason → a standing preference
//
// Placeholder destination and dates are left to the brief's direct edit:
// they need typing, not a chip, and every chip answer would solve the same
// plan anyway. PURE.

import { planFullness } from './family';
import { dayLabel } from './changes';
import { addDays, dayNumber } from './solver/calendar';
import { haversineM } from './solver/estimate';
import { windowsOn } from './solver/hours';
import type { Booking, Facts, LatLng, LocalDate, PlannedDay, SolvedPlan, Stay, TravellerProfile, Trip, TripOp, Wish } from './model';
import { ANSWER_LABEL_MAX, QUESTION_PROMPT_MAX, type BriefPatch, type PackCalendarItem, type PackKind, type PackPlace, type PlanDiff, type QuestionDraft, type RejectReason } from './decisions';
import { wetParts } from './pack';

/** A draft with the generator's say on assume-and-ask: false = never apply the default unasked (a whole shape). */
export type Draft = QuestionDraft & { assume?: boolean };

export interface Alternatives {
  groupId: string;
  kind: 'shape' | 'day';
  date: LocalDate | null;
  items: Array<{ id: string; title: string; ops: TripOp[]; score: number }>;
}

export interface GenContext {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  profile: TravellerProfile | null;
  plan: SolvedPlan;
  places: PackPlace[];
  calendar: PackCalendarItem[];
  /** What was turned down, with why (proposals and pack places). */
  rejected: Array<{ reason: RejectReason; kind: PackKind | null; title: string }>;
  /** Open groups of alternatives, each solved (lower score is better). */
  alternatives: Alternatives[];
  today: LocalDate;
}

// ── Small helpers ──────────────────────────────────────────────────────────

/** A chip: at most ANSWER_LABEL_MAX characters, cut at a word. */
export function shortLabel(s: string, max = ANSWER_LABEL_MAX): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : cut.length).replace(/[,.;:—-]+$/, '')}…`;
}

const prompt = (s: string) => (s.length <= QUESTION_PROMPT_MAX ? s : `${s.slice(0, QUESTION_PROMPT_MAX - 1)}…`);
const weekday = (d: LocalDate) => dayLabel(d).split(' ')[0];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where each planned wish is: its day and stop. */
function plannedStops(plan: SolvedPlan): Map<string, { date: LocalDate; day: PlannedDay; arriveMin: number }> {
  const out = new Map<string, { date: LocalDate; day: PlannedDay; arriveMin: number }>();
  for (const day of plan.days) for (const s of day.stops) if (s.kind === 'wish' && s.wishId) out.set(s.wishId, { date: day.date, day, arriveMin: s.arriveMin });
  return out;
}

/** The pack place a wish stands for: by the place's own link, its OSM id, or its name. */
export function packPlaceFor(w: Pick<Wish, 'id' | 'title' | 'place'>, places: PackPlace[]): PackPlace | null {
  return (
    places.find((p) => p.wishId === w.id) ??
    (w.place?.osmId ? places.find((p) => p.place.osmId === w.place!.osmId) : undefined) ??
    places.find((p) => p.name.toLowerCase() === w.title.toLowerCase()) ??
    null
  );
}

function factsFor(w: Wish, places: PackPlace[]): Facts | null {
  return w.facts ?? packPlaceFor(w, places)?.facts ?? null;
}

const hasBooked = (w: Wish, bookings: Booking[]) => bookings.some((b) => b.wishId === w.id && b.status !== 'cancelled');

/** Movable: not locked, not booked, not a must. */
const movable = (w: Wish, bookings: Booking[]) => !w.locked && w.fixedStartMin === null && w.priority !== 'must' && !bookings.some((b) => b.wishId === w.id && b.status === 'booked');

// ── brief ──────────────────────────────────────────────────────────────────

/** Nights of the trip with no stay (the night of each date, start … end − 1). */
export function uncoveredNights(trip: Pick<Trip, 'startDate' | 'endDate'>, stays: Array<Pick<Stay, 'fromDate' | 'toDate'>>): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = trip.startDate; d < trip.endDate; d = addDays(d, 1)) if (!stays.some((s) => s.fromDate <= d && d < s.toDate)) out.push(d);
  return out;
}

export function briefQuestions(c: GenContext): Draft[] {
  const out: Draft[] = [];
  const nights = c.stays.length ? uncoveredNights(c.trip, c.stays) : [];
  if (nights.length) {
    const first = nights[0];
    const last = nights[nights.length - 1];
    // The stay nearest in time to the gap stretches to cover it.
    const stay = [...c.stays].sort((a, b) => Math.min(Math.abs(dayNumber(a.toDate) - dayNumber(first)), Math.abs(dayNumber(a.fromDate) - dayNumber(addDays(last, 1)))) - Math.min(Math.abs(dayNumber(b.toDate) - dayNumber(first)), Math.abs(dayNumber(b.fromDate) - dayNumber(addDays(last, 1)))))[0];
    const fromDate = first < stay.fromDate ? first : stay.fromDate;
    const toDate = addDays(last, 1) > stay.toDate ? addDays(last, 1) : stay.toDate;
    const when = nights.length === 1 ? `the night of ${dayLabel(first)}` : `${plural(nights.length, 'night')} (${nights.map(weekday).join(', ')})`;
    out.push({
      key: `brief:stay-nights:${nights.join(',')}`,
      origin: 'brief',
      prompt: prompt(`No stay yet for ${when}. Stay at ${stay.name} then too?`),
      why: 'Changes where those days start and end',
      answers: [
        { label: 'Yes, the same place', ops: [{ op: 'updateStay', id: stay.id, fields: { fromDate, toDate } }] },
        { label: 'Somewhere else', ops: [] },
      ],
      defaultIndex: 0,
      ifSkipped: `If you skip: ${stay.name} for those nights too.`,
      audience: 'owner',
    });
  }
  if (!(c.profile?.travellers ?? []).length && c.trip.pace !== 'relaxed') {
    out.push({
      key: 'brief:travellers',
      origin: 'brief',
      prompt: 'Who is going — adults only, or with children?',
      why: 'Children change the pace of every day',
      answers: [
        { label: 'Adults only', ops: [] },
        { label: 'With children', ops: [{ op: 'setTrip', fields: { pace: 'relaxed' } }] },
      ],
      defaultIndex: 0,
      ifSkipped: 'If you skip: planned for adults.',
      audience: 'owner',
    });
  }
  return out;
}

// ── tie ────────────────────────────────────────────────────────────────────

/** Two alternatives within this share of each other's score are a tie. */
export const TIE_SHARE = 0.1;

export function tieQuestions(c: GenContext): Draft[] {
  const out: Draft[] = [];
  for (const g of c.alternatives) {
    // Whole-trip shapes are already a choice on screen (the shape pager);
    // asking "which of these two?" again only repeats it.
    if (g.kind === 'shape') continue;
    const items = [...g.items].sort((a, b) => a.score - b.score).slice(0, 3);
    if (items.length < 2) continue;
    const [a, b] = items;
    const scale = Math.max(Math.abs(a.score), Math.abs(b.score), 1);
    if (Math.abs(b.score - a.score) / scale > TIE_SHARE) continue;
    const close = items.filter((x) => Math.abs(x.score - a.score) / scale <= TIE_SHARE);
    out.push({
      key: `tie:${g.groupId}`,
      origin: 'tie',
      prompt: g.kind === 'shape' ? 'Two ways to do the trip come out almost level. Which suits you?' : `Two versions of ${dayLabel(g.date ?? c.trip.startDate)} come out almost level. Which suits you?`,
      why: g.kind === 'shape' ? 'Decides the shape of the whole trip' : `Decides ${dayLabel(g.date ?? c.trip.startDate)}`,
      answers: close.map((x) => ({ label: shortLabel(x.title), ops: x.ops })),
      defaultIndex: 0,
      ifSkipped: 'If you skip: nothing changes until you choose.',
      audience: 'owner',
      // A whole trip shape is never applied unasked.
      assume: false,
    });
  }
  return out;
}

// ── clash ──────────────────────────────────────────────────────────────────

export function clashQuestions(c: GenContext): Draft[] {
  const out: Draft[] = [];
  const at = plannedStops(c.plan);
  const fullness = planFullness(c.plan, c.trip.pace, c.trip.dayLoads ?? {});
  const byId = new Map(c.wishes.map((w) => [w.id, w]));
  const dayWishes = (date: LocalDate) => [...at].filter(([, s]) => s.date === date).map(([id]) => byId.get(id)).filter((w): w is Wish => !!w);
  for (const d of c.plan.dropped) {
    const w = byId.get(d.wishId);
    if (!w || w.skipped || w.suggested) continue;
    const booked = c.bookings.some((b) => b.wishId === w.id && b.status === 'booked');
    if (w.priority !== 'must' && !booked) continue;
    // Where it would go: its own day, else the day with the most that could give way.
    const dates = c.plan.days.map((x) => x.date);
    const day = w.fixedDate ?? [...dates].sort((x, y) => dayWishes(y).filter((v) => movable(v, c.bookings)).length - dayWishes(x).filter((v) => movable(v, c.bookings)).length || x.localeCompare(y))[0];
    if (!day) continue;
    const pin = w.fixedDate ? [] : [{ op: 'updateWish', id: w.id, fields: { fixedDate: day } }];
    const giveWay = dayWishes(day).filter((v) => movable(v, c.bookings)).sort((x, y) => (y.durationSec ?? 0) - (x.durationSec ?? 0))[0];
    const answers: Draft['answers'] = [{ label: 'Leave it out for now', ops: [] }];
    if (giveWay) answers.push({ label: shortLabel(`Drop ${giveWay.title}`), ops: [...pin, { op: 'updateWish', id: giveWay.id, fields: { skipped: true } }] });
    if ((c.trip.dayLoads ?? {})[day] !== 'full') answers.push({ label: shortLabel(`A fuller ${weekday(day)}`), ops: [...pin, { op: 'setTrip', fields: { dayLoads: { [day]: 'full' } } }] });
    if (answers.length < 2) continue;
    out.push({
      key: `clash:dropped:${w.id}`,
      origin: 'clash',
      prompt: prompt(`${w.title} doesn't fit${w.fixedDate ? ` on ${dayLabel(w.fixedDate)}` : ''}. What should give?`),
      why: `${w.title} is ${booked ? 'booked' : 'a must'} but the plan leaves it out (${d.reason})`.slice(0, 160),
      answers,
      defaultIndex: 0,
      ifSkipped: `If you skip: ${w.title} stays out of the plan.`,
      audience: 'owner',
    });
  }
  for (const [date, f] of Object.entries(fullness)) {
    if (f.band !== 'overfull') continue;
    const candidates = dayWishes(date).filter((v) => movable(v, c.bookings));
    const lightest = Object.entries(fullness)
      .filter(([d]) => d !== date)
      .sort((x, y) => x[1].pct - y[1].pct || x[0].localeCompare(y[0]))[0]?.[0];
    const move = candidates.sort((x, y) => (y.durationSec ?? 0) - (x.durationSec ?? 0))[0];
    if (!move || !lightest) continue;
    out.push({
      key: `clash:overfull:${date}`,
      origin: 'clash',
      prompt: prompt(`${dayLabel(date)} is over-full. Move ${move.title} to ${weekday(lightest)}?`),
      why: `${dayLabel(date)} is planned at ${f.pct}% of a ${c.trip.pace} day`,
      answers: [
        { label: 'Keep it full', ops: [] },
        { label: shortLabel(`Move it to ${weekday(lightest)}`), ops: [{ op: 'updateWish', id: move.id, fields: { fixedDate: lightest } }] },
        { label: 'Make it lighter', ops: [{ op: 'setTrip', fields: { dayLoads: { [date]: 'light' } } }] },
      ],
      defaultIndex: 0,
      ifSkipped: 'If you skip: the day stays as planned.',
      audience: 'owner',
    });
  }
  return out;
}

// ── research ───────────────────────────────────────────────────────────────

const OUTDOOR_KINDS: readonly PackKind[] = ['park', 'viewpoint', 'walk'];

function isOutdoor(w: Wish, places: PackPlace[]): boolean {
  const p = packPlaceFor(w, places);
  if (!p) return false;
  return p.indoor === false || p.tags.includes('outdoor') || (p.indoor === null && OUTDOOR_KINDS.includes(p.kind));
}

export function researchQuestions(c: GenContext): Draft[] {
  const out: Draft[] = [];
  const at = plannedStops(c.plan);
  const dates = c.plan.days.map((d) => d.date);
  for (const w of c.wishes) {
    const s = at.get(w.id);
    if (!s || w.skipped || w.suggested) continue;
    const facts = factsFor(w, c.places);
    // Needs booking, and nothing is booked for it yet.
    if (facts?.bookingRequired && facts.bookAheadDays != null && !hasBooked(w, c.bookings)) {
      const due = addDays(s.date, -facts.bookAheadDays);
      const deadline = due < c.today ? c.today : due;
      const late = due < c.today;
      out.push({
        key: `research:book:${w.id}`,
        origin: 'research',
        prompt: prompt(late ? `${w.title} usually books up ${plural(facts.bookAheadDays, 'day')} ahead — it may already be full. Keep it?` : `${w.title} needs booking about ${plural(facts.bookAheadDays, 'day')} ahead — by ${dayLabel(deadline)}. Keep it?`),
        why: `Planned for ${dayLabel(s.date)}`,
        answers: [
          { label: "Keep it, I'll book", ops: [{ op: 'addBooking', booking: { wishId: w.id, title: w.title, date: s.date, status: 'to-book' } }] },
          { label: 'Skip it', ops: [{ op: 'updateWish', id: w.id, fields: { skipped: true } }] },
        ],
        defaultIndex: 0,
        ifSkipped: `If you skip: ${w.title} stays in — remember to book it.`,
        audience: 'owner',
        deadline,
      });
    }
    // Closed on the day it is planned.
    const open = windowsOn(facts, s.date);
    if (open !== null && open.length === 0) {
      const other = dates.filter((d) => d !== s.date).find((d) => {
        const w2 = windowsOn(facts, d);
        return w2 === null || w2.length > 0;
      });
      if (other && !w.locked) {
        out.push({
          key: `research:closed:${w.id}:${s.date}`,
          origin: 'research',
          prompt: prompt(`${w.title} is closed on ${dayLabel(s.date)}. Move it to ${weekday(other)}?`),
          why: 'Its opening hours say it is shut that day',
          answers: [
            { label: shortLabel(`Move it to ${weekday(other)}`), ops: [{ op: 'updateWish', id: w.id, fields: { fixedDate: other } }] },
            { label: 'Skip it', ops: [{ op: 'updateWish', id: w.id, fields: { skipped: true } }] },
          ],
          defaultIndex: 0,
          ifSkipped: `If you skip: ${w.title} moves to ${dayLabel(other)}.`,
          audience: 'owner',
        });
      }
    }
  }
  // Rain on a day with outdoor stops.
  for (const date of dates) {
    const parts = wetParts(c.calendar, date);
    if (!parts.length) continue;
    const outdoor = [...at].filter(([, s]) => s.date === date).map(([id]) => c.wishes.find((w) => w.id === id)).filter((w): w is Wish => !!w && isOutdoor(w, c.places) && movable(w, c.bookings));
    if (!outdoor.length) continue;
    const dry = dates.filter((d) => d !== date && !wetParts(c.calendar, d).length);
    const answers: Draft['answers'] = [{ label: 'Keep the plan', ops: [] }];
    if (dry.length) answers.push({ label: shortLabel(`Move them to ${weekday(dry[0])}`), ops: outdoor.map((w) => ({ op: 'updateWish', id: w.id, fields: { fixedDate: dry[0] } })) });
    const centre = outdoor[0].place?.location ?? null;
    const indoor = c.places
      .filter((p) => p.status === 'candidate' && p.indoor === true && !['food', 'cafe', 'gelato'].includes(p.kind))
      .sort((a, b) => (centre ? haversineM(centre, a.place.location) - haversineM(centre, b.place.location) : 0))
      .slice(0, Math.min(2, outdoor.length));
    if (indoor.length) {
      answers.push({
        label: 'Indoor places instead',
        ops: [
          ...outdoor.map((w) => ({ op: 'updateWish', id: w.id, fields: { skipped: true } })),
          ...indoor.map((p) => addPackWish(p, date)),
        ],
      });
    }
    if (answers.length < 2) continue;
    const when = parts.length === 3 ? 'all day' : parts.join(' and ');
    out.push({
      key: `research:rain:${date}`,
      origin: 'research',
      prompt: prompt(`Rain likely ${weekday(date)} ${when}. Change the outdoor stops (${outdoor.map((w) => w.title).slice(0, 2).join(', ')})?`),
      why: 'The forecast for your dates',
      answers,
      defaultIndex: 0,
      ifSkipped: 'If you skip: the plan stays as it is.',
      audience: 'owner',
    });
  }
  return out;
}

/** An addWish for a pack place, its place already found (replayed with trusted places). */
export function addPackWish(p: PackPlace, fixedDate: LocalDate | null): TripOp {
  return {
    op: 'addWish',
    wish: {
      title: p.name,
      placeQuery: null,
      priority: 'nice',
      durationMin: p.durationMin,
      partOfDay: 'any',
      fixedDate,
      fixedStartMin: null,
      note: null,
      replacesMeal: null,
      place: { name: p.place.name, location: p.place.location, osmId: p.place.osmId, address: p.place.address },
    },
  };
}

// ── reaction ───────────────────────────────────────────────────────────────

/** 20 minutes on foot. */
export const CLOSE_M = 1600;

const KIND_WORDS: Partial<Record<PackKind, string>> = { museum: 'museums', church: 'churches', park: 'parks', viewpoint: 'viewpoints', market: 'markets', sight: 'sights', food: 'restaurants', cafe: 'cafés', shop: 'shops', kids: 'children’s places', experience: 'tours' };

export function reactionQuestions(c: GenContext): Draft[] {
  const out: Draft[] = [];
  const at = plannedStops(c.plan);
  const planned = c.wishes.filter((w) => at.has(w.id) && !w.skipped && movable(w, c.bookings));
  const count = (r: RejectReason) => c.rejected.filter((x) => x.reason === r).length;
  const stayOf = (date: LocalDate): LatLng | null => c.stays.find((s) => s.fromDate <= date && date < s.toDate)?.location ?? c.stays[0]?.location ?? null;
  if (count('too-far') >= 2) {
    const far = planned.filter((w) => {
      const home = stayOf(at.get(w.id)!.date);
      return !!home && !!w.place && haversineM(home, w.place.location) > CLOSE_M;
    });
    if (far.length) {
      out.push({
        key: 'reaction:too-far',
        origin: 'reaction',
        prompt: 'Keep everything within 20 minutes’ walk of where you’re staying?',
        why: `You turned down ${plural(count('too-far'), 'idea')} as too far`,
        answers: [
          { label: 'No, distance is fine', ops: [] },
          { label: 'Yes, keep it close', ops: far.map((w) => ({ op: 'updateWish', id: w.id, fields: { skipped: true } })), remember: 'Keep places within about 20 minutes’ walk of where we stay' },
        ],
        defaultIndex: 0,
        ifSkipped: 'If you skip: places further away stay in.',
        audience: 'owner',
      });
    }
  }
  if (count('too-busy') >= 2) {
    const famous = planned.filter((w) => {
      const p = packPlaceFor(w, c.places);
      return !!p && !p.lessVisited && !['food', 'cafe', 'gelato'].includes(p.kind);
    });
    const quiet = c.places.filter((p) => p.status === 'candidate' && p.lessVisited && !['food', 'cafe', 'gelato'].includes(p.kind)).slice(0, famous.length);
    if (famous.length) {
      out.push({
        key: 'reaction:too-busy',
        origin: 'reaction',
        prompt: 'Swap the famous crowds for quieter places?',
        why: `You turned down ${plural(count('too-busy'), 'idea')} as too busy`,
        answers: [
          { label: 'No, keep them', ops: [] },
          { label: 'Yes, quieter', ops: [...famous.map((w) => ({ op: 'updateWish', id: w.id, fields: { skipped: true } })), ...quiet.map((p) => addPackWish(p, at.get(famous[0].id)?.date ?? null))], remember: 'Prefer quieter places to the famous sights' },
        ],
        defaultIndex: 0,
        ifSkipped: 'If you skip: the famous places stay in.',
        audience: 'owner',
      });
    }
  }
  const notForUs = new Map<PackKind, number>();
  for (const r of c.rejected) if (r.reason === 'not-for-us' && r.kind) notForUs.set(r.kind, (notForUs.get(r.kind) ?? 0) + 1);
  for (const [kind, n] of notForUs) {
    if (n < 2) continue;
    const same = planned.filter((w) => packPlaceFor(w, c.places)?.kind === kind);
    const word = KIND_WORDS[kind] ?? 'of these';
    if (!same.length) continue;
    out.push({
      key: `reaction:fewer:${kind}`,
      origin: 'reaction',
      prompt: prompt(`Fewer ${word}?`),
      why: `You turned down ${plural(n, 'one')} of these as not for you`,
      answers: [
        { label: 'No, keep them', ops: [] },
        { label: 'Yes, fewer', ops: same.map((w) => ({ op: 'updateWish', id: w.id, fields: { skipped: true } })), remember: `Fewer ${word} on our trips` },
      ],
      defaultIndex: 0,
      ifSkipped: `If you skip: the ${word} stay in.`,
      audience: 'owner',
    });
  }
  return out;
}

/** Every rule's drafts, the first of each key kept. */
export function generateQuestions(c: GenContext): Draft[] {
  const all = [...researchQuestions(c), ...clashQuestions(c), ...briefQuestions(c), ...tieQuestions(c), ...reactionQuestions(c)];
  return all.filter((q, i) => all.findIndex((x) => x.key === q.key) === i);
}

// ── Checking ───────────────────────────────────────────────────────────────

/** ×3 within 3 days of the deadline, ×2 within 14, else ×1. */
export function urgency(deadline: LocalDate | null | undefined, today: LocalDate): number {
  if (!deadline) return 1;
  const days = dayNumber(deadline) - dayNumber(today);
  if (days <= 3) return 3;
  if (days <= 14) return 2;
  return 1;
}

/**
 * What a plan IS, for "do these answers give different plans": each day's
 * wish stops in order with their time to the quarter hour, what is left out,
 * and the trip facts the solver reads. New places compare by name (a dry
 * run's ids are its own).
 */
export function planSignature(plan: SolvedPlan, trip?: Partial<Pick<Trip, 'pace' | 'modes' | 'startDate' | 'endDate' | 'dayLoads'>>): string {
  const id = (wishId: string | null, title: string) => (!wishId || wishId.startsWith('dry-') ? `new:${title.toLowerCase()}` : wishId);
  const days = plan.days.map((d) => `${d.date}=${d.stops.filter((s) => s.kind === 'wish').map((s) => `${id(s.wishId, s.title)}@${Math.round(s.arriveMin / 15)}`).join(',')}`);
  const dropped = plan.dropped.map((d) => d.wishId).sort();
  return JSON.stringify([days, dropped, trip ? [trip.pace, trip.modes, trip.startDate, trip.endDate, trip.dayLoads ?? {}] : null]);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/** One line: what choosing it changes. Null when nothing does. */
export function answerSummary(diff: PlanDiff): string | null {
  if (!diff.changes.length) return null;
  const byDate = new Map<string, typeof diff.changes>();
  for (const ch of diff.changes) {
    const d = ch.date ?? ch.fromDate ?? '';
    byDate.set(d, [...(byDate.get(d) ?? []), ch]);
  }
  const parts = [...byDate].slice(0, 2).map(([date, list]) => {
    const head = date ? `${dayLabel(date)}: ` : '';
    if (list.length > 1) return `${head}${plural(list.length, 'stop')} change`;
    const ch = list[0];
    const what =
      ch.kind === 'added' ? 'added' : ch.kind === 'removed' ? 'taken out' : ch.kind === 'dropped' ? 'left out' : ch.kind === 'moved' ? `moves to ${ch.date ? weekday(ch.date) : 'another day'}` : `moves to ${ch.toMin !== null ? hhmm(ch.toMin) : 'another time'}`;
    return `${head}${ch.title} ${what}`;
  });
  const more = byDate.size > 2 ? ` · ${plural(byDate.size - 2, 'more day')}` : '';
  return `${parts.join(' · ')}${more}`.slice(0, 160);
}

/** "Changes Wed 28 Oct (3 stops)". */
export function whyLine(dates: LocalDate[], stops: number): string {
  const ds = [...new Set(dates)].sort();
  const when = ds.length === 0 ? 'the plan' : ds.length <= 2 ? ds.map((d) => dayLabel(d)).join(' and ') : `${dayLabel(ds[0])} and ${plural(ds.length - 1, 'other day')}`;
  return `Changes ${when} (${plural(stops, 'stop')})`;
}

/** A brief edit an answer makes, as ops. */
export function briefPatchOps(patch: BriefPatch | null | undefined): TripOp[] {
  if (!patch) return [];
  switch (patch.field) {
    case 'dates':
      return [{ op: 'setTrip', fields: { startDate: patch.startDate, endDate: patch.endDate } }];
    case 'destination':
      return [{ op: 'setTrip', fields: { destination: patch.destination, ...(patch.timeZone ? { timeZone: patch.timeZone } : {}) } }];
    case 'pace':
      return [{ op: 'setTrip', fields: { pace: patch.pace } }];
    case 'modes':
      return [{ op: 'setTrip', fields: { modes: patch.modes } }];
    case 'travellers':
      return [{ op: 'updateProfile', profile: { travellers: patch.travellers.map((t) => ({ name: t.name, relation: null, notes: [], age: t.age ?? null, personId: t.personId ?? null })) } }];
    case 'stay':
      return patch.id
        ? [{ op: 'updateStay', id: patch.id, fields: { name: patch.name, fromDate: patch.fromDate, toDate: patch.toDate, placeQuery: patch.placeQuery } }]
        : [{ op: 'addStay', name: patch.name, placeQuery: patch.placeQuery, fromDate: patch.fromDate, toDate: patch.toDate, checkInMin: null, checkOutMin: null }];
    default:
      return [];
  }
}

export interface Snapshot {
  trip: Trip;
  stays: Stay[];
  wishes: Wish[];
  bookings: Booking[];
  profile: TravellerProfile | null;
}

const WISH_FIELDS = ['title', 'priority', 'partOfDay', 'fixedDate', 'fixedStartMin', 'note', 'locked', 'skipped', 'replacesMeal'] as const;

/** True when every op can be put back by `inverseOps` (so a default may be applied unasked). */
export function canInvert(ops: TripOp[]): boolean {
  return ops.every((o) => {
    if (o.op === 'setTrip' || o.op === 'addWish' || o.op === 'addBooking' || o.op === 'addStay' || o.op === 'removeWish') return true;
    if (o.op === 'updateStay') return !('placeQuery' in (o.fields ?? {}));
    if (o.op === 'updateWish') return Object.keys(o.fields ?? {}).every((k) => (WISH_FIELDS as readonly string[]).includes(k) || k === 'durationMin');
    if (o.op === 'updateProfile') return Object.keys(o.profile ?? {}).every((k) => k === 'travellers');
    return false;
  });
}

/**
 * The ops that put back what `ops` did, in reverse order, from the state
 * before and after — so a question whose default was applied unasked can
 * still be answered the other way. Null when one cannot be put back.
 */
export function inverseOps(ops: TripOp[], before: Snapshot, after: Pick<Snapshot, 'stays' | 'wishes' | 'bookings'>): TripOp[] | null {
  if (!canInvert(ops)) return null;
  const out: TripOp[] = [];
  const newWish = (title: string) => after.wishes.find((w) => w.title.toLowerCase() === title.toLowerCase() && !before.wishes.some((b) => b.id === w.id));
  for (const o of [...ops].reverse()) {
    switch (o.op) {
      case 'setTrip': {
        const fields: Record<string, unknown> = {};
        for (const k of Object.keys(o.fields)) {
          if (k === 'dayLoads') fields.dayLoads = Object.fromEntries(Object.keys(o.fields.dayLoads ?? {}).map((d) => [d, before.trip.dayLoads?.[d] ?? 'normal']));
          else fields[k] = (before.trip as unknown as Record<string, unknown>)[k];
        }
        out.push({ op: 'setTrip', fields } as TripOp);
        break;
      }
      case 'updateStay': {
        const s = before.stays.find((x) => x.id === o.id);
        if (!s) return null;
        out.push({ op: 'updateStay', id: o.id, fields: Object.fromEntries(Object.keys(o.fields).map((k) => [k, (s as unknown as Record<string, unknown>)[k]])) } as TripOp);
        break;
      }
      case 'addStay': {
        const s = after.stays.find((x) => x.name === o.name && !before.stays.some((b) => b.id === x.id));
        if (!s) return null;
        out.push({ op: 'removeStay', id: s.id });
        break;
      }
      case 'updateWish': {
        const w = before.wishes.find((x) => x.id === o.id);
        if (!w) return null;
        const fields: Record<string, unknown> = {};
        for (const k of Object.keys(o.fields)) fields[k] = k === 'durationMin' ? (w.durationSec ? Math.round(w.durationSec / 60) : null) : (w as unknown as Record<string, unknown>)[k];
        out.push({ op: 'updateWish', id: o.id, fields } as TripOp);
        break;
      }
      case 'addWish': {
        const w = newWish(o.wish.title);
        if (!w) return null;
        out.push({ op: 'removeWish', id: w.id });
        break;
      }
      case 'removeWish': {
        const w = before.wishes.find((x) => x.id === o.id);
        if (!w) return null;
        out.push({ op: 'addWish', wish: { title: w.title, placeQuery: null, priority: w.priority, durationMin: w.durationSec ? Math.round(w.durationSec / 60) : null, partOfDay: w.partOfDay, fixedDate: w.fixedDate, fixedStartMin: w.fixedStartMin, note: w.note, replacesMeal: w.replacesMeal ?? null, place: w.place } });
        break;
      }
      case 'addBooking': {
        const b = after.bookings.find((x) => x.title === o.booking.title && !before.bookings.some((y) => y.id === x.id));
        if (!b) return null;
        out.push({ op: 'updateBooking', id: b.id, fields: { status: 'cancelled' } });
        break;
      }
      case 'updateProfile':
        out.push({ op: 'updateProfile', profile: { travellers: before.profile?.travellers ?? [] } });
        break;
      default:
        return null;
    }
  }
  return out;
}
