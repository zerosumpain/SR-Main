// src/lib/trips/proposals.ts
//
// v8: proposals, the pure half. A proposal is a stored, checked change you
// see before it lands (./decisions Proposal); this module decides WHAT to
// propose from the research pack and how to describe it, without I/O:
//
//  - the slot a swap or fill is for (the stop and its neighbours, or the gap
//    in a part of the day), refusing locked and booked stops — those never
//    move in a proposal;
//  - which pack places are worth checking: near the slot (distance from the
//    stop before and after), open that day by their facts, not already
//    planned or turned down, the right kind (a place to eat for a meal);
//  - the nudges — closer, cheaper, less walking, quieter, more like this —
//    re-ranking from the same slot, relative to the proposal nudged;
//  - keeping the best three that fit, at least one less visited when one
//    fits (the plan's answer to everyone piling into the same five sights);
//  - the day variants (lighter, rainy, swap two days) as ops;
//  - the pack's facts as a wish's facts, the "materially different" test a
//    stale proposal is re-checked with, and the legacy option cards the
//    family's current app still draws (it ignores proposals).
//
// The checking itself (dry runs, storage) is ./proposals.server.

import { windowsOn } from '$lib/trips/solver';
import { dayLabel } from './changes';
import type { Nudge, PackKind, PackPlace, PlanDiff, Proposal, ProposalDraft, RejectReason } from './decisions';
import { computeGap, type Gap, type MealRole, type Verdict } from './ideas';
import { DAY_STAGE_LABEL, type Booking, type DayStage, type Facts, type LatLng, type LocalDate, type PartOfDay, type SolvedPlan, type Trip, type TripOp, type Wish, type WishDraft } from './model';
import { metresBetween } from './nearby-ideas';
import { optionFit, type OptionDraft, type PlanOption } from './options';
import { emptyFacts } from './research';
import { stagedStops } from './stages';

/** At most this many pack places are dry-run for one swap or fill (the < 2 s budget). */
export const MAX_CANDIDATES = 12;
/** Alternatives in one group: a phone compares at most two side by side; three to flick through. */
export const GROUP_SIZE = 3;

// ── The slot ───────────────────────────────────────────────────────────────

export interface Slot {
  kind: 'swap' | 'fill';
  date: LocalDate;
  stage: DayStage;
  gap: Gap;
  /** The stop a swap replaces. */
  replaces: { wishId: string; title: string; location: LatLng | null; priority: Wish['priority']; replacesMeal: Wish['replacesMeal'] } | null;
}

export interface SlotTarget {
  stopId?: string | null;
  wishId?: string | null;
  date?: LocalDate | null;
  stage?: DayStage | null;
}

type Refusal = { ok: false; status: number; error: string };

/** True when a wish is fixed by the person: locked, at a set time, or booked. */
export function isPinned(w: Pick<Wish, 'id' | 'locked' | 'fixedStartMin'>, bookings: Booking[]): boolean {
  return w.locked || w.fixedStartMin !== null || bookings.some((b) => b.wishId === w.id && b.status === 'booked');
}

/**
 * The slot to propose for. A swap names a planned stop (by stop or wish id):
 * its neighbours are the gap's ends. A fill names a day and a part of it.
 */
export function slotFor(plan: SolvedPlan, wishes: Wish[], bookings: Booking[], kind: 'swap' | 'fill', target: SlotTarget): { ok: true; slot: Slot } | Refusal {
  if (kind === 'fill') {
    if (!target.date || !target.stage) return { ok: false, status: 400, error: 'Say which day and which part of it.' };
    const gap = computeGap(plan, target.date, target.stage);
    if (!gap) return { ok: false, status: 404, error: 'That day is not in the plan.' };
    return { ok: true, slot: { kind, date: gap.date, stage: gap.stage, gap, replaces: null } };
  }
  for (const day of plan.days) {
    const stops = stagedStops(day);
    const at = stops.findIndex((s) => s.kind === 'wish' && s.wishId && (s.id === target.stopId || s.wishId === target.stopId || s.wishId === target.wishId));
    if (at < 0) continue;
    const stop = stops[at];
    const wish = wishes.find((w) => w.id === stop.wishId);
    if (!wish) return { ok: false, status: 404, error: 'That stop is no longer on the trip.' };
    if (isPinned(wish, bookings)) return { ok: false, status: 409, error: `${wish.title} is locked or booked, so it stays where it is. Unlock it first to swap it.` };
    const before = stops[at - 1] ?? stop;
    const after = stops[at + 1] ?? stop;
    const stage = stop.stage ?? 'morning';
    const meal: MealRole = wish.replacesMeal ?? null;
    const gap: Gap = {
      date: day.date,
      stage,
      before: { stopId: before.id, title: before.title, location: before.location, min: before === stop ? stop.arriveMin : before.departMin },
      after: { stopId: after.id, title: after.title, location: after.location, min: after === stop ? stop.departMin : after.arriveMin },
      freeMin: Math.max(0, (after === stop ? stop.departMin : after.arriveMin) - (before === stop ? stop.arriveMin : before.departMin)),
      meal,
      replacesStopId: null,
    };
    return { ok: true, slot: { kind, date: day.date, stage, gap, replaces: { wishId: wish.id, title: wish.title, location: stop.location, priority: wish.priority, replacesMeal: wish.replacesMeal ?? null } } };
  }
  return { ok: false, status: 404, error: 'That stop is not in the plan.' };
}

// ── Which pack places to check ─────────────────────────────────────────────

const EAT: readonly PackKind[] = ['food', 'cafe'];
const OUTDOOR: readonly PackKind[] = ['walk', 'park', 'viewpoint', 'market'];

/** Places to eat for a meal slot; anything but a meal for any other. */
function kindFits(kind: PackKind, meal: MealRole): boolean {
  if (meal) return EAT.includes(kind);
  return kind !== 'food';
}

export interface Candidate {
  place: PackPlace;
  /** Metres from the nearer end of the slot. */
  distanceM: number;
}

/** How far a place is from the slot: the nearer of the stop before, the stop after, and the stop replaced. */
export function slotDistance(slot: Slot, at: LatLng, fallback: LatLng | null = null): number {
  const ends = [slot.gap.before.location, slot.gap.after.location, slot.replaces?.location ?? null].filter((x): x is LatLng => !!x);
  const anchors = ends.length ? ends : fallback ? [fallback] : [];
  if (!anchors.length) return Number.POSITIVE_INFINITY;
  return Math.min(...anchors.map((a) => metresBetween(a, at)));
}

/**
 * Pack places worth dry-running for a slot, nearest first: candidates only
 * (not planned, not turned down), not already a wish, open that day as far as
 * their facts say (unknown counts as open), and the right kind.
 */
/**
 * What a swap should resemble: the place it replaces. A two-hour museum swapped
 * for a ten-minute column is not an alternative (seen on the preview: the
 * Capitoline Museums' swaps were the Column of Phoca, the Forum of Nerva and a
 * viewpoint, because they were nearest).
 */
export interface Likeness {
  kind: PackPlace['kind'] | null;
  durationMin: number | null;
  indoor: boolean | null;
}

/** Metres-equivalent penalty for being unlike the replaced stop (0 when alike or unknown). */
export function unlikeness(p: Pick<PackPlace, 'kind' | 'durationMin' | 'indoor'>, like: Likeness | null | undefined): number {
  if (!like) return 0;
  let pen = 0;
  if (like.kind && p.kind !== like.kind) pen += 800;
  if (like.durationMin && p.durationMin) {
    const r = p.durationMin / like.durationMin;
    if (r < 0.5 || r > 2) pen += 1200;
  }
  if (like.indoor !== null && p.indoor !== null && p.indoor !== like.indoor) pen += 300;
  return pen;
}

export function rankCandidates(places: PackPlace[], slot: Slot, wishes: Wish[], opts: { limit?: number; exclude?: Set<string>; anchor?: LatLng | null; like?: Likeness | null } = {}): Candidate[] {
  const titles = new Set(wishes.filter((w) => !w.skipped).map((w) => w.title.trim().toLowerCase()));
  const osm = new Set(wishes.filter((w) => !w.skipped && w.place?.osmId).map((w) => w.place!.osmId as string));
  const meal = slot.replaces ? (slot.replaces.replacesMeal ?? null) : slot.gap.meal;
  return places
    .filter((p) => p.status === 'candidate' && !opts.exclude?.has(p.id))
    .filter((p) => !titles.has(p.name.trim().toLowerCase()) && !(p.place.osmId && osm.has(p.place.osmId)))
    .filter((p) => kindFits(p.kind, meal))
    .filter((p) => {
      const w = windowsOn(packFacts(p), slot.date);
      return w === null || w.length > 0;
    })
    .map((p) => ({ place: p, distanceM: slotDistance(slot, p.place.location, opts.anchor ?? null), pen: unlikeness(p, opts.like) }))
    .sort((a, b) => a.distanceM + a.pen - (b.distanceM + b.pen) || a.place.name.localeCompare(b.place.name))
    .map(({ pen: _pen, ...c }) => c)
    .slice(0, opts.limit ?? MAX_CANDIDATES);
}

// ── Nudges ─────────────────────────────────────────────────────────────────

/** A price as a number to compare, from "Free", "€10 each", "About £15": 0 for free, null when unknown. */
export function costValue(p: Pick<PackPlace, 'costText' | 'tags'>): number | null {
  if (p.tags?.includes('free')) return 0;
  const t = p.costText ?? '';
  if (/\bfree\b|no charge|gratis|gratuit/i.test(t)) return 0;
  const m = /(\d+(?:[.,]\d+)?)/.exec(t);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export interface NudgeRef {
  place: PackPlace | null;
  distanceM: number | null;
  walkMin: number | null;
}

/**
 * Re-rank the slot's candidates for a nudge, relative to the proposal
 * nudged. `less-walking` is decided after the dry runs (`orderChecked`), so
 * here it keeps the order. A nudge that nothing satisfies returns [].
 */
export function nudgeRank(cands: Candidate[], nudge: Nudge, ref: NudgeRef): Candidate[] {
  switch (nudge) {
    case 'closer':
      return cands.filter((c) => ref.distanceM === null || c.distanceM < ref.distanceM - 50);
    case 'cheaper': {
      const was = ref.place ? costValue(ref.place) : null;
      return cands
        .map((c) => ({ c, v: costValue(c.place) }))
        .filter((x) => x.v !== null && (was === null ? true : x.v < was))
        .sort((a, b) => (a.v as number) - (b.v as number) || a.c.distanceM - b.c.distanceM)
        .map((x) => x.c);
    }
    case 'quieter':
      return cands.filter((c) => c.place.lessVisited);
    case 'more-like-this': {
      if (!ref.place) return cands;
      const tags = new Set(ref.place.tags);
      return cands
        .map((c) => ({ c, score: (c.place.kind === ref.place!.kind ? 2 : 0) + c.place.tags.filter((t) => tags.has(t)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.c.distanceM - b.c.distanceM)
        .map((x) => x.c);
    }
    case 'less-walking':
      return cands;
  }
}

/** After the dry runs: less-walking orders by the walk each adds, and keeps only those that walk less than the one nudged. */
export function orderChecked<T extends { walkMin: number | null }>(checked: T[], nudge: Nudge | null, ref: NudgeRef | null): T[] {
  if (nudge !== 'less-walking') return checked;
  const was = ref?.walkMin ?? null;
  return checked
    .filter((c) => c.walkMin !== null && (was === null || c.walkMin < was))
    .sort((a, b) => (a.walkMin as number) - (b.walkMin as number));
}

/**
 * The best `n` that fit, in the order given — with at least one less-visited
 * place when one fits, so a group is never just the famous few.
 */
export function pickBest<T extends { fits: boolean; lessVisited: boolean }>(checked: T[], n = GROUP_SIZE): T[] {
  const fitting = checked.filter((c) => c.fits);
  const best = fitting.slice(0, n);
  if (best.length === n && !best.some((c) => c.lessVisited)) {
    const quiet = fitting.slice(n).find((c) => c.lessVisited);
    if (quiet) best[n - 1] = quiet;
  }
  return best;
}

// ── Pack places as wishes ──────────────────────────────────────────────────

/** A pack place's facts as a wish's (./model Facts): what the research found, so hours count in every check. */
export function packFacts(p: PackPlace): Facts {
  const base = p.facts ?? emptyFacts('brief', p.checkedAt);
  return {
    ...base,
    bookingRequired: base.bookingRequired ?? p.bookingRequired,
    bookAheadDays: base.bookAheadDays ?? p.bookAheadDays,
    priceText: base.priceText ?? p.costText,
    typicalVisitSec: base.typicalVisitSec ?? (p.durationMin ? p.durationMin * 60 : null),
    summary: base.summary ?? p.why,
    sources: base.sources?.length ? base.sources : p.sources,
    checkedAt: base.checkedAt ?? p.checkedAt,
  };
}

const PART: Record<DayStage, PartOfDay> = { morning: 'morning', lunch: 'any', afternoon: 'afternoon', evening: 'evening' };

/** The wish a pack place becomes in a slot: pinned to the day, in the part of it, carrying its place. */
export function packWish(p: PackPlace, slot: Pick<Slot, 'date' | 'stage' | 'gap' | 'replaces'>): WishDraft {
  // Only a place to eat becomes the meal; a museum in an evening slot is not dinner.
  const meal = EAT.includes(p.kind) ? (slot.replaces ? (slot.replaces.replacesMeal ?? null) : slot.gap.meal) : null;
  return {
    title: p.name,
    placeQuery: null,
    priority: slot.replaces?.priority ?? 'nice',
    durationMin: p.durationMin ?? 60,
    partOfDay: meal ? 'any' : PART[slot.stage],
    fixedDate: slot.date,
    fixedStartMin: null,
    note: p.why ? `${dayLabel(slot.date)} ${DAY_STAGE_LABEL[slot.stage].toLowerCase()}: ${p.why}` : null,
    replacesMeal: meal,
    place: { name: p.place.name, location: p.place.location, osmId: p.place.osmId, address: p.place.address },
  };
}

const KIND_WORD: Record<PackKind, string> = {
  sight: 'A sight', museum: 'A museum', church: 'A church', walk: 'A walk', park: 'A park', viewpoint: 'A viewpoint', market: 'A market',
  food: 'Somewhere to eat', cafe: 'A café', gelato: 'Gelato', kids: 'Something for the children', shop: 'A shop', experience: 'Something to do', other: 'A place',
};

/** A swap or fill draft from a pack place: its ops carry the place (trusted when checked). */
export function packDraft(p: PackPlace, slot: Slot, group: string): ProposalDraft {
  const wish = packWish(p, slot);
  const ops: TripOp[] = [...(slot.replaces ? [{ op: 'removeWish' as const, id: slot.replaces.wishId }] : []), { op: 'addWish', wish }];
  const near = p.neighbourhood ? ` in ${p.neighbourhood}` : '';
  return {
    kind: slot.kind,
    title: p.name,
    why: p.why ?? `${KIND_WORD[p.kind]}${near}.`,
    ops,
    group,
    scope: { date: slot.date, stage: slot.stage, stopId: slot.replaces?.wishId ?? null, wishId: slot.replaces?.wishId ?? null },
    packPlaceId: p.id,
    costText: p.costText,
    indoor: p.indoor,
    kidFriendly: p.kidFriendly,
    evidence: p.sources,
  };
}

// ── Day variants ───────────────────────────────────────────────────────────

/** The wishes planned on a date that the person has not fixed (locked, timed, booked never move). */
export function movableOn(plan: SolvedPlan, wishes: Wish[], bookings: Booking[], date: LocalDate): Wish[] {
  const day = plan.days.find((d) => d.date === date);
  const ids = new Set((day?.stops ?? []).filter((s) => s.kind === 'wish' && s.wishId).map((s) => s.wishId as string));
  return wishes.filter((w) => ids.has(w.id) && !isPinned(w, bookings));
}

export function lighterOps(trip: Pick<Trip, 'dayLoads' | 'startDate' | 'endDate'>, date: LocalDate): { ok: true; ops: TripOp[] } | Refusal {
  if (date < trip.startDate || date > trip.endDate) return { ok: false, status: 400, error: 'That day is not part of the trip.' };
  if (trip.dayLoads?.[date] === 'light') return { ok: false, status: 409, error: `${dayLabel(date)} is already a light day.` };
  return { ok: true, ops: [{ op: 'setTrip', fields: { dayLoads: { [date]: 'light' } } }] };
}

/**
 * Exchange two days: the unfixed wishes on each go to the other, and so do
 * the days' loads. Locked, timed and booked stops stay where they are.
 */
export function swapDaysOps(plan: SolvedPlan, trip: Pick<Trip, 'dayLoads' | 'startDate' | 'endDate'>, wishes: Wish[], bookings: Booking[], date: LocalDate, withDate: LocalDate | null | undefined): { ok: true; ops: TripOp[]; kept: string[] } | Refusal {
  if (!withDate || withDate === date) return { ok: false, status: 400, error: 'Say which day to swap with.' };
  for (const d of [date, withDate]) if (d < trip.startDate || d > trip.endDate) return { ok: false, status: 400, error: 'That day is not part of the trip.' };
  const a = movableOn(plan, wishes, bookings, date);
  const b = movableOn(plan, wishes, bookings, withDate);
  if (!a.length && !b.length) return { ok: false, status: 409, error: `Nothing on ${dayLabel(date)} or ${dayLabel(withDate)} can move.` };
  const ops: TripOp[] = [
    ...a.map((w) => ({ op: 'updateWish' as const, id: w.id, fields: { fixedDate: withDate } })),
    ...b.map((w) => ({ op: 'updateWish' as const, id: w.id, fields: { fixedDate: date } })),
  ];
  const la = trip.dayLoads?.[date] ?? 'normal';
  const lb = trip.dayLoads?.[withDate] ?? 'normal';
  if (la !== lb) ops.push({ op: 'setTrip', fields: { dayLoads: { [date]: lb, [withDate]: la } } });
  const pinnedOn = (d: LocalDate) => {
    const day = plan.days.find((x) => x.date === d);
    const ids = new Set((day?.stops ?? []).filter((s) => s.wishId).map((s) => s.wishId));
    return wishes.filter((w) => ids.has(w.id) && isPinned(w, bookings)).map((w) => w.title);
  };
  return { ok: true, ops, kept: [...pinnedOn(date), ...pinnedOn(withDate)] };
}

/** The pack place a wish was made from (or is): by its wish id, its OSM id, or its name. */
export function packOf(w: Wish, pack: PackPlace[]): PackPlace | null {
  return (
    pack.find((p) => p.wishId === w.id) ??
    (w.place?.osmId ? pack.find((p) => p.place.osmId === w.place!.osmId) : undefined) ??
    pack.find((p) => p.name.trim().toLowerCase() === w.title.trim().toLowerCase()) ??
    null
  );
}

/** Outdoors, as far as the pack knows: its indoor flag, else its kind. Unknown is not outdoors. */
export function isOutdoor(p: PackPlace | null): boolean {
  if (!p) return false;
  if (p.indoor !== null) return !p.indoor;
  return OUTDOOR.includes(p.kind);
}

/**
 * The rainy-day version of a day: each outdoor nice-to-have that is not fixed
 * comes off and the nearest indoor pack place open that day takes its place.
 * Must-dos and fixed stops stay (and are named, so the card can say so).
 */
export function rainyOps(plan: SolvedPlan, wishes: Wish[], bookings: Booking[], pack: PackPlace[], date: LocalDate): { ok: true; ops: TripOp[]; swaps: Array<{ out: string; in: string }>; kept: string[] } | Refusal {
  const day = plan.days.find((d) => d.date === date);
  if (!day) return { ok: false, status: 404, error: 'That day is not in the plan.' };
  const stops = stagedStops(day);
  const onDay = stops.filter((s) => s.kind === 'wish' && s.wishId).map((s) => ({ stop: s, wish: wishes.find((w) => w.id === s.wishId) })).filter((x): x is { stop: (typeof stops)[number]; wish: Wish } => !!x.wish);
  const outdoor = onDay.filter((x) => isOutdoor(packOf(x.wish, pack)));
  if (!outdoor.length) return { ok: false, status: 409, error: `Nothing on ${dayLabel(date)} is outdoors, as far as the research found.` };
  const used = new Set<string>();
  const ops: TripOp[] = [];
  const swaps: Array<{ out: string; in: string }> = [];
  const kept: string[] = [];
  for (const { stop, wish } of outdoor) {
    if (wish.priority === 'must' || isPinned(wish, bookings)) {
      kept.push(wish.title);
      continue;
    }
    const slot: Slot = {
      kind: 'swap',
      date,
      stage: stop.stage ?? 'morning',
      gap: { date, stage: stop.stage ?? 'morning', before: { stopId: stop.id, title: stop.title, location: stop.location, min: stop.arriveMin }, after: { stopId: stop.id, title: stop.title, location: stop.location, min: stop.departMin }, freeMin: stop.departMin - stop.arriveMin, meal: wish.replacesMeal ?? null, replacesStopId: null },
      replaces: { wishId: wish.id, title: wish.title, location: stop.location, priority: wish.priority, replacesMeal: wish.replacesMeal ?? null },
    };
    const indoor = rankCandidates(pack.filter((p) => p.indoor === true && !used.has(p.id)), slot, wishes, { limit: 1 })[0];
    if (!indoor) continue;
    used.add(indoor.place.id);
    ops.push({ op: 'removeWish', id: wish.id }, { op: 'addWish', wish: packWish(indoor.place, slot) });
    swaps.push({ out: wish.title, in: indoor.place.name });
  }
  if (!swaps.length) return { ok: false, status: 409, error: kept.length ? `The outdoor stops on ${dayLabel(date)} are must-dos or fixed, so they stay.` : `The research found nothing indoors near ${dayLabel(date)}'s stops.` };
  return { ok: true, ops, swaps, kept };
}

// ── Describing a change ────────────────────────────────────────────────────

/** "2 stops move · 1 left out · 1.2 km more walking" — for a change that is not one place. */
export function changeSummary(diff: PlanDiff): string {
  const count = (k: string) => diff.changes.filter((c) => c.kind === k).length;
  const parts: string[] = [];
  const added = count('added');
  const moved = count('moved') + count('retimed');
  const out = count('removed') + count('dropped');
  if (added) parts.push(`${added} added`);
  if (moved) parts.push(`${moved} ${moved === 1 ? 'stop moves' : 'stops move'}`);
  if (out) parts.push(`${out} left out`);
  if (diff.walkDeltaM !== null && Math.abs(diff.walkDeltaM) >= 200) parts.push(`${(Math.abs(diff.walkDeltaM) / 1000).toFixed(1)} km ${diff.walkDeltaM > 0 ? 'more' : 'less'} walking`);
  return parts.join(' · ') || 'Small changes to the times';
}

/**
 * Whether a re-check differs from what was shown enough to show it again
 * before applying: a different set of stops added, moved to another day,
 * removed or left out. Re-timings alone are not material — the solver
 * re-times freely and the card says times are approximate.
 */
export function materiallyDiffers(shown: PlanDiff, now: PlanDiff): boolean {
  const key = (d: PlanDiff) =>
    d.changes
      .filter((c) => c.kind !== 'retimed')
      .map((c) => `${c.kind}|${c.kind === 'added' ? c.title : (c.wishId ?? c.title)}|${c.date ?? ''}|${c.fromDate ?? ''}`)
      .sort()
      .join('\n');
  return key(shown) !== key(now) || [...shown.dropped].sort().join('|') !== [...now.dropped].sort().join('|');
}

/** The fit line for a slot proposal, from the solver's verdict (./options `optionFit`). */
export const fitLine = (v: Verdict) => optionFit(v);

/**
 * The legacy option card (./options PlanOption) for a fill or swap proposal
 * — what the family's current app draws, so an open request still shows
 * cards it can tap ("Add this") until the app learns proposals.
 */
export function legacyOption(p: Pick<Proposal, 'kind' | 'title' | 'why' | 'ops' | 'scope' | 'tradeoffs'>, verdict: Verdict, index: number): PlanOption | null {
  if (p.kind !== 'fill' && p.kind !== 'swap') return null;
  const add = p.ops.find((o): o is Extract<TripOp, { op: 'addWish' }> => o.op === 'addWish');
  if (!add || !add.wish.place || !p.scope.date || !p.scope.stage) return null;
  return {
    id: `${p.scope.date}:${p.scope.stage}:${index}`,
    date: p.scope.date,
    stage: p.scope.stage,
    title: p.title,
    why: p.why,
    fit: p.tradeoffs.fitText ?? optionFit(verdict),
    indoor: p.tradeoffs.indoor,
    kidFriendly: p.tradeoffs.kidFriendly,
    costText: p.tradeoffs.costText,
    wish: { ...add.wish, placeQuery: add.wish.placeQuery ?? `${add.wish.place.name}` },
    verdict,
  };
}

/**
 * A slot to offer something for when the planner could only talk: the
 * emptiest open part of the earliest day from `from` on (no stops of its
 * own), morning, afternoon or evening.
 */
export function openSlot(plan: SolvedPlan, from: LocalDate): { date: LocalDate; stage: DayStage } | null {
  let best: { date: LocalDate; stage: DayStage; free: number } | null = null;
  for (const day of plan.days) {
    if (day.date < from) continue;
    for (const stage of ['afternoon', 'morning', 'evening'] as const) {
      const busy = stagedStops(day).some((s) => s.kind === 'wish' && s.stage === stage);
      if (busy) continue;
      const gap = computeGap(plan, day.date, stage);
      if (!gap || gap.freeMin < 60) continue;
      if (!best || gap.freeMin > best.free) best = { date: day.date, stage, free: gap.freeMin };
    }
    if (best) return { date: best.date, stage: best.stage };
  }
  return null;
}

// ── Requests (lenient readers for the routes) ──────────────────────────────

export type DayVariant = 'lighter' | 'rainy' | 'swap-days';

export interface ProposalRequest {
  kind: 'swap' | 'fill' | 'day' | 'nudge' | 'shapes';
  /** `packPlaceId` with a fill: "Add to the plan" from the research pack — that place on that day. */
  target: SlotTarget & { proposalId?: string | null; packPlaceId?: string | null };
  nudge: Nudge | null;
  variant: DayVariant | null;
  withDate: LocalDate | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isDate = (v: unknown): v is LocalDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const STAGES: readonly DayStage[] = ['morning', 'lunch', 'afternoon', 'evening'];
const NUDGE_SET: readonly Nudge[] = ['closer', 'cheaper', 'less-walking', 'quieter', 'more-like-this'];

/** `POST proposals`: what to propose for, or a sentence saying what is missing. */
export function readProposalRequest(raw: unknown): { ok: true; request: ProposalRequest } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Send the request as JSON.' };
  const kind = raw.kind;
  if (kind !== 'swap' && kind !== 'fill' && kind !== 'day' && kind !== 'nudge' && kind !== 'shapes') return { ok: false, error: "kind is 'swap', 'fill', 'day', 'nudge' or 'shapes'." };
  const t = isObj(raw.target) ? raw.target : {};
  const target = {
    stopId: text(t.stopId, 160),
    wishId: text(t.wishId, 80),
    date: isDate(t.date) ? t.date : null,
    stage: STAGES.includes(t.stage as DayStage) ? (t.stage as DayStage) : null,
    proposalId: text(t.proposalId, 80),
    packPlaceId: text(t.packPlaceId, 80),
  };
  const nudge = NUDGE_SET.includes(raw.nudge as Nudge) ? (raw.nudge as Nudge) : null;
  const variant = raw.variant === 'lighter' || raw.variant === 'rainy' || raw.variant === 'swap-days' ? raw.variant : null;
  const withDate = isDate(raw.withDate) ? raw.withDate : null;
  if (kind === 'swap' && !target.stopId && !target.wishId) return { ok: false, error: 'Say which stop to swap.' };
  if (kind === 'fill' && (!target.date || (!target.stage && !target.packPlaceId))) return { ok: false, error: 'Say which day and which part of it.' };
  if (kind === 'day' && (!target.date || !variant)) return { ok: false, error: "Say which day, and 'lighter', 'rainy' or 'swap-days'." };
  if (kind === 'nudge' && (!target.proposalId || !nudge)) return { ok: false, error: 'Say which proposal, and closer, cheaper, less-walking, quieter or more-like-this.' };
  return { ok: true, request: { kind, target, nudge, variant, withDate } };
}

/** `POST proposals/:pid`: accept, or turn down with a reason. */
export function readDecision(raw: unknown): { ok: true; action: 'accept' } | { ok: true; action: 'reject'; reason: RejectReason; note: string | null } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Send the decision as JSON.' };
  if (raw.action === 'accept') return { ok: true, action: 'accept' };
  if (raw.action === 'reject') {
    const reasons = ['too-far', 'too-busy', 'not-for-us', 'been-before', 'other'] as const;
    const reason = reasons.includes(raw.reason as (typeof reasons)[number]) ? (raw.reason as (typeof reasons)[number]) : 'other';
    return { ok: true, action: 'reject', reason, note: text(raw.note, 200) };
  }
  return { ok: false, error: "action is 'accept' or 'reject'." };
}

/**
 * v7's `options` read as one `fill` group (v8): each a wish pinned to its day
 * and part of the day — lunch and the evening are that meal, as an idea for
 * that slot is (./ideas `ideaDraft`) — placed by its query when checked.
 */
export function optionDrafts(options: OptionDraft[]): ProposalDraft[] {
  const meal: Record<DayStage, WishDraft['replacesMeal']> = { morning: null, lunch: 'lunch', afternoon: null, evening: 'dinner' };
  return options.map((o) => ({
    kind: 'fill' as const,
    title: o.title,
    why: o.why,
    ops: [
      {
        op: 'addWish',
        wish: { title: o.title, placeQuery: o.placeQuery, priority: 'nice', durationMin: o.durationMin, partOfDay: meal[o.stage] ? 'any' : PART[o.stage], fixedDate: o.date, fixedStartMin: null, note: o.why || null, replacesMeal: meal[o.stage] },
      },
    ],
    group: 'options',
    scope: { date: o.date, stage: o.stage, stopId: null, wishId: null },
    packPlaceId: null,
    costText: o.costText,
    indoor: o.indoor,
    kidFriendly: o.kidFriendly,
    evidence: [],
  }));
}
