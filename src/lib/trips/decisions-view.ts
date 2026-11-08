// src/lib/trips/decisions-view.ts
//
// v8, the site's half of "propose, research, ask": the small pure rules the
// decision cards are drawn by — how a plan difference reads as before → after
// per day, the trade-off chips on a proposal, what differs between two
// proposals side by side, the brief's source labels, a question's deadline, a
// research job's progress lines, the research pack's filters, the ghost a
// preview draws on the map, and the legacy `options` turned into cards. No
// I/O, so every rule is a unit test (decisions-view.test.ts). The server owns
// every decision; nothing here decides anything, it only says it.

import { dayLabel } from './changes';
import {
  EMPTY_DIFF,
  FACT_SOURCE_LABEL,
  type BriefItem,
  type JobStage,
  type JobStageState,
  type PackKind,
  type PackPlace,
  type PlanChange,
  type PlanChangeKind,
  type PlanDiff,
  type Proposal,
  type ProposalKind,
  type ProposalTradeoffs,
  type TripStart,
} from './decisions';
import type { DayStage, LatLng, LocalDate, PlaceImage, PlannedDay } from './model';
import type { PlanOption } from './options';

// ── Words and numbers ──────────────────────────────────────────────────────

/** Local minutes → "15:10" (24-hour). Null in, empty out. */
export function clock(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "Tue 27 Oct 15:10", "Tue 27 Oct", "15:10" — whatever is known. */
export function whenText(date: LocalDate | null, min: number | null): string {
  return [date ? dayLabel(date) : '', clock(min)].filter(Boolean).join(' ');
}

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 850 → "850 m", 1240 → "1.2 km". */
export function distanceText(m: number): string {
  const a = Math.abs(m);
  if (a < 1000) return `${Math.max(50, Math.round(a / 50) * 50)} m`;
  return `${(Math.round(a / 100) / 10).toString()} km`;
}

/** The trip's walking difference in metres, in words; null when unknown. */
export function walkDeltaText(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  if (Math.abs(m) < 100) return 'About the same walking';
  return m < 0 ? `${distanceText(m)} less walking` : `${distanceText(m)} more walking`;
}

/** Walking minutes added (+) or saved (−). */
export function walkMinText(min: number): string {
  const r = Math.round(min);
  if (r === 0) return 'Same walking';
  return r < 0 ? `${-r} min less walking` : `${r} min more walking`;
}

/** "Checked 21 Oct" from an ISO timestamp; null when never checked. */
export function checkedText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return `Checked ${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}

/** A source link's words when it has no title: its host. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

/** The Commons credit under a photo: "Photo: Jane Smith · CC BY-SA 4.0 · Wikimedia Commons". */
export function creditLine(image: Pick<PlaceImage, 'credit' | 'license'>): string {
  return ['Photo' + (image.credit ? `: ${image.credit}` : ''), image.license, 'Wikimedia Commons'].filter(Boolean).join(' · ');
}

const STAGE_WORD: Record<DayStage, string> = { morning: 'morning', lunch: 'lunch', afternoon: 'afternoon', evening: 'evening' };

// ── What changed: before → after, per day ─────────────────────────────────

export interface ChangeRow {
  kind: PlanChangeKind;
  /** "Added", "Moved", "Retimed", "Taken out", "Left out". */
  verb: string;
  title: string;
  /** Where it was: "Tue 27 Oct 15:00", or null for something new. */
  before: string | null;
  /** Where it is now: "Wed 28 Oct 11:45", "Taken out", "Left out". */
  after: string | null;
  reason: string | null;
}

export const CHANGE_VERB: Record<PlanChangeKind, string> = {
  added: 'Added',
  moved: 'Moved',
  retimed: 'Retimed',
  removed: 'Taken out',
  dropped: 'Left out',
};

/** One structured change as a ledger row. */
export function changeRow(c: PlanChange): ChangeRow {
  const base = { kind: c.kind, verb: CHANGE_VERB[c.kind], title: c.title, reason: c.reason };
  switch (c.kind) {
    case 'added':
      return { ...base, before: null, after: whenText(c.date, c.toMin) || null };
    case 'moved':
      return { ...base, before: whenText(c.fromDate, c.fromMin) || null, after: whenText(c.date, c.toMin) || null };
    case 'retimed':
      return { ...base, before: clock(c.fromMin) || null, after: clock(c.toMin) || null };
    case 'removed':
      return { ...base, before: whenText(c.fromDate, c.fromMin) || null, after: 'Taken out' };
    case 'dropped':
      return { ...base, before: whenText(c.fromDate ?? c.date, c.fromMin) || null, after: 'Left out' };
  }
}

export interface ChangeDay {
  /** The day it is about (null: a change with no day, listed last). */
  date: LocalDate | null;
  label: string;
  rows: ChangeRow[];
}

/** A diff's structured changes grouped by the day they land on (or left), in date order. */
export function changeDays(diff: Pick<PlanDiff, 'changes'>): ChangeDay[] {
  const by = new Map<string, ChangeDay>();
  for (const c of diff.changes) {
    const date = c.date ?? c.fromDate ?? null;
    const key = date ?? '~';
    if (!by.has(key)) by.set(key, { date, label: date ? dayLabel(date) : 'Not on a day', rows: [] });
    by.get(key)!.rows.push(changeRow(c));
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, d]) => d);
}

/** "What changed" after any action: the card the rail shows, with its Undo. */
export interface ChangeCard {
  id: number;
  /** "Used: Palazzo Altemps", "Answered: Carry on", "Changed directly". */
  title: string;
  planVersion: number | null;
  days: ChangeDay[];
  /** Plain lines, when there are no structured changes (older responses, direct edits). */
  lines: string[];
  walk: string | null;
  /** The version Undo restores; null when there is nothing to undo. */
  undoTo: number | null;
  /** A lasting preference the answer offers for memory — shown, never saved silently. */
  remember: string | null;
  /** Undo for an undo: the version that was just undone. */
  redoTo?: number | null;
  /** Shown without taking focus (a chat turn: the person is still typing). */
  quiet?: boolean;
}

export interface ChangeResponse {
  planVersion?: number | null;
  changes?: unknown;
  diff?: Partial<PlanDiff> | null;
  undo?: { toVersion: number } | null;
  remember?: string | null;
}

const NO_CHANGE = 'No change to the schedule.';

/** Plain change lines from a `changes` that may be strings (today) or a diff. */
export function changeLines(changes: unknown): string[] {
  if (Array.isArray(changes)) return changes.filter((c): c is string => typeof c === 'string' && c !== NO_CHANGE);
  if (changes && typeof changes === 'object' && Array.isArray((changes as PlanDiff).lines)) return changeLines((changes as PlanDiff).lines);
  return [];
}

/**
 * The card for an action's response. Undo restores the response's own
 * `undo.toVersion` when it says (null = nothing to undo); a response that does
 * not say (a direct edit, an older chat turn) undoes to the version before.
 */
export function changeCard(id: number, title: string, res: ChangeResponse): ChangeCard {
  const diff = res.diff && Array.isArray(res.diff.changes) ? ({ ...EMPTY_DIFF, ...res.diff } as PlanDiff) : null;
  const days = diff ? changeDays(diff) : [];
  const lines = days.length ? [] : changeLines(diff?.lines?.length ? diff.lines : res.changes);
  const v = typeof res.planVersion === 'number' ? res.planVersion : null;
  const changed = days.length > 0 || lines.length > 0;
  const undoTo = 'undo' in res ? (res.undo?.toVersion ?? null) : v !== null && v > 1 && changed ? v - 1 : null;
  return { id, title, planVersion: v, days, lines, walk: walkDeltaText(diff?.walkDeltaM), undoTo, remember: res.remember ?? null };
}

// ── Proposals ──────────────────────────────────────────────────────────────

export interface Chip {
  key: string;
  label: string;
  /** 'good' reads as a plus, 'warn' as a cost; colour is never the only cue (the words say it). */
  tone: 'good' | 'warn' | 'plain';
}

/** The trade-off chips on a proposal card. */
export function tradeoffChips(t: ProposalTradeoffs): Chip[] {
  const out: Chip[] = [];
  if (t.fitText) out.push({ key: 'fit', label: t.fitText, tone: t.fits ? 'plain' : 'warn' });
  else if (!t.fits) out.push({ key: 'fit', label: 'Does not fit as the day stands', tone: 'warn' });
  if (t.walkMin !== null && t.walkMin !== undefined) out.push({ key: 'walk', label: walkMinText(t.walkMin), tone: t.walkMin < 0 ? 'good' : t.walkMin > 10 ? 'warn' : 'plain' });
  if (t.walkKmPerDay !== null && t.walkKmPerDay !== undefined) out.push({ key: 'km', label: `${Math.round(t.walkKmPerDay * 10) / 10} km a day`, tone: 'plain' });
  if (t.earlyStarts !== null && t.earlyStarts !== undefined) out.push({ key: 'early', label: t.earlyStarts === 0 ? 'No early starts' : plural(t.earlyStarts, 'early start'), tone: 'plain' });
  if (t.toBook) out.push({ key: 'book', label: `${t.toBook} to book`, tone: 'plain' });
  if (t.costText) out.push({ key: 'cost', label: t.costText, tone: 'plain' });
  if (t.indoor === true) out.push({ key: 'indoor', label: 'Indoors', tone: 'plain' });
  else if (t.indoor === false) out.push({ key: 'indoor', label: 'Outdoors', tone: 'plain' });
  if (t.kidFriendly === true) out.push({ key: 'kids', label: 'Good for children', tone: 'good' });
  if (t.lessVisited) out.push({ key: 'quiet', label: 'Less visited', tone: 'good' });
  if (t.pushesOut.length) out.push({ key: 'pushes', label: `Pushes out ${listText(t.pushesOut)}`, tone: 'warn' });
  for (const m of t.moves.slice(0, 2)) out.push({ key: `move:${m.title}`, label: `Moves ${m.title} to ${dayLabel(m.to)}`, tone: 'warn' });
  return out;
}

export interface CompareRow {
  key: string;
  label: string;
  a: string;
  b: string;
  differs: boolean;
}

function compareValues(p: Proposal): Record<string, string> {
  const t = p.tradeoffs;
  const yn = (v: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : '');
  const changes = p.diff.changes.length || p.diff.lines.length;
  return {
    what: p.title,
    when: t.fitText ?? (t.fits ? 'Fits' : 'Does not fit'),
    walk: t.walkMin !== null && t.walkMin !== undefined ? walkMinText(t.walkMin) : (walkDeltaText(p.diff.walkDeltaM) ?? ''),
    km: t.walkKmPerDay !== null && t.walkKmPerDay !== undefined ? `${Math.round(t.walkKmPerDay * 10) / 10} km` : '',
    early: t.earlyStarts !== null && t.earlyStarts !== undefined ? (t.earlyStarts === 0 ? 'None' : String(t.earlyStarts)) : '',
    book: t.toBook !== null && t.toBook !== undefined ? (t.toBook === 0 ? 'Nothing' : String(t.toBook)) : '',
    cost: t.costText ?? '',
    indoor: t.indoor === true ? 'Indoors' : t.indoor === false ? 'Outdoors' : '',
    kids: yn(t.kidFriendly),
    quiet: t.lessVisited ? 'Yes' : 'No',
    pushes: t.pushesOut.length ? listText(t.pushesOut) : 'Nothing',
    moves: t.moves.length ? listText(t.moves.map((m) => `${m.title} to ${dayLabel(m.to)}`)) : 'Nothing',
    leaves: p.shape ? (p.shape.leavesOut.length ? listText(p.shape.leavesOut) : 'Nothing') : '',
    changes: changes ? plural(changes, 'change') : '',
  };
}

const COMPARE_LABEL: Array<[string, string]> = [
  ['what', 'What'],
  ['when', 'When'],
  ['walk', 'Walking'],
  ['km', 'Walking a day'],
  ['early', 'Early starts'],
  ['book', 'To book'],
  ['cost', 'Cost'],
  ['indoor', 'Indoors or out'],
  ['kids', 'Good for children'],
  ['quiet', 'Less visited'],
  ['pushes', 'Pushes out'],
  ['moves', 'Moves'],
  ['leaves', 'Leaves out'],
  ['changes', 'Changes to the plan'],
];

/**
 * Two proposals side by side: a row per thing either one says, marked where
 * they differ (the compare view highlights only those). A value one side does
 * not know reads "—".
 */
export function compareRows(a: Proposal, b: Proposal): CompareRow[] {
  const va = compareValues(a);
  const vb = compareValues(b);
  const out: CompareRow[] = [];
  for (const [key, label] of COMPARE_LABEL) {
    if (!va[key] && !vb[key]) continue;
    const x = va[key] || '—';
    const y = vb[key] || '—';
    out.push({ key, label, a: x, b: y, differs: x !== y });
  }
  return out;
}

export interface ProposalGroupView {
  groupId: string;
  kind: ProposalKind;
  heading: string;
  proposals: Proposal[];
}

/** What a group of alternatives is about, as its heading in the rail. */
export function groupHeading(first: Proposal): string {
  const { date, stage } = first.scope;
  const day = date ? dayLabel(date) : null;
  switch (first.kind) {
    case 'swap': {
      const out = first.diff.changes.find((c) => c.kind === 'removed' || c.kind === 'dropped');
      return out ? `Instead of ${out.title}${day ? `, ${day}` : ''}` : `A swap${day ? ` for ${day}` : ''}`;
    }
    case 'fill':
      return day ? `For ${day}${stage ? `, ${STAGE_WORD[stage]}` : ''}` : 'Ideas to fit in';
    case 'day':
      return day ? `${day}, another way` : 'Another way to do the day';
    case 'fix':
      return 'Something to sort out';
    case 'replan':
      return 'On the day';
    case 'shape':
      return 'Ways to do the trip';
    case 'change':
    default:
      return 'Ready for you to approve';
  }
}

/**
 * Open proposals as the rail shows them: the trip shapes on their own (they
 * are the first thing to choose, drawn big), the rest as groups of
 * alternatives in the order they arrived.
 */
export function groupProposals(ps: Proposal[]): { shapes: Proposal[]; groups: ProposalGroupView[] } {
  const shapes: Proposal[] = [];
  const groups = new Map<string, ProposalGroupView>();
  for (const p of ps) {
    if (p.status !== 'open') continue;
    if (p.kind === 'shape') {
      shapes.push(p);
      continue;
    }
    if (!groups.has(p.groupId)) groups.set(p.groupId, { groupId: p.groupId, kind: p.kind, heading: groupHeading(p), proposals: [] });
    groups.get(p.groupId)!.proposals.push(p);
  }
  return { shapes, groups: [...groups.values()] };
}

/**
 * The proposals to show: the server's, then any an action returned that the
 * page has not reloaded yet, minus those decided here. Matched by id, never by
 * object identity; a local copy (a re-checked stale proposal) wins.
 */
export function mergeProposals(server: Proposal[], local: Proposal[], gone: ReadonlySet<string>): Proposal[] {
  const fresh = new Map(local.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: Proposal[] = [];
  for (const p of [...server, ...local]) {
    if (seen.has(p.id) || gone.has(p.id) || gone.has(`group:${p.groupId}`)) continue;
    seen.add(p.id);
    out.push(fresh.get(p.id) ?? p);
  }
  return out;
}

/** Stops on the plan a proposal would move or take out (wish ids are stop ids), for the preview marks. */
export function affectedStops(p: Proposal): Set<string> {
  const out = new Set<string>();
  if (p.scope.stopId) out.add(p.scope.stopId);
  if (p.scope.wishId) out.add(p.scope.wishId);
  for (const c of p.diff.changes) if (c.wishId && c.kind !== 'added') out.add(c.wishId);
  return out;
}

/** Days a proposal touches, in order. */
export function affectedDates(p: Proposal): LocalDate[] {
  const s = new Set<LocalDate>();
  if (p.scope.date) s.add(p.scope.date);
  for (const d of p.diff.dates) s.add(d);
  for (const d of p.preview) s.add(d.date);
  return [...s].sort();
}

// ── The map: plan days and a proposal's ghost ──────────────────────────────

/** Structurally TripMap's `MapDay`. */
export interface SketchDay {
  date: string;
  label: string;
  stops: Array<{ id: string; title: string; location: LatLng; n: number }>;
  legs: Array<{ line: LatLng[] | null; from: LatLng; to: LatLng }>;
}

/** A solved day as the map draws it: placed wish stops, numbered, and the legs between placed points. */
export function mapDayOf(day: PlannedDay): SketchDay {
  let n = 0;
  const loc = new Map(day.stops.map((s) => [s.id, s.location]));
  return {
    date: day.date,
    label: dayLabel(day.date),
    stops: day.stops.filter((s) => s.kind === 'wish' && s.location).map((s) => ({ id: s.id, title: s.title, location: s.location as LatLng, n: ++n })),
    legs: day.legs
      .filter((l) => loc.get(l.fromStopId) && loc.get(l.toStopId))
      .map((l) => ({ line: l.line ?? null, from: loc.get(l.fromStopId) as LatLng, to: loc.get(l.toStopId) as LatLng })),
  };
}

/**
 * The ghost a preview draws: the proposal's solved days when the server sent
 * them, else just the place it adds as a single pin.
 */
export function ghostDays(p: Proposal): SketchDay[] {
  if (p.preview.length) return p.preview.map(mapDayOf);
  if (p.place) {
    const date = p.scope.date ?? '';
    return [{ date, label: date ? dayLabel(date) : 'Proposed', stops: [{ id: `ghost:${p.id}`, title: p.place.name, location: p.place.location, n: 1 }], legs: [] }];
  }
  return [];
}

// ── The planner's legacy `options` ─────────────────────────────────────────

/**
 * A v7 option (the site has never shown them) as a proposal-like card. It has
 * no stored proposal behind it: "Use this" adds its wish through the wishes
 * route, and nudges, compare and reasons do not apply.
 */
export function optionAsProposal(o: PlanOption): Proposal {
  return {
    id: `option:${o.id}`,
    groupId: `options:${o.date}:${o.stage}`,
    kind: 'fill',
    title: o.title,
    why: o.why,
    scope: { date: o.date, stage: o.stage, stopId: null, wishId: null },
    ops: [],
    diff: EMPTY_DIFF,
    tradeoffs: {
      fits: o.verdict.fits,
      fitText: o.fit || null,
      walkMin: null,
      walkKmPerDay: null,
      earlyStarts: null,
      toBook: null,
      costText: o.costText,
      indoor: o.indoor,
      kidFriendly: o.kidFriendly,
      lessVisited: false,
      pushesOut: o.verdict.pushesOut,
      moves: o.verdict.moves.map((m) => ({ title: m.title, from: m.from, to: m.to })),
    },
    evidence: [],
    place: o.wish.place ? { name: o.wish.place.name, location: o.wish.place.location } : null,
    image: null,
    packPlaceId: null,
    shape: null,
    preview: [],
    basedOnVersion: null,
    status: 'open',
    reason: null,
    createdAt: '',
    decidedAt: null,
  };
}

/** A legacy option card's id → the option's own id. */
export const isOptionCard = (p: Pick<Proposal, 'id'>) => p.id.startsWith('option:');

// ── The brief ──────────────────────────────────────────────────────────────

export type BriefEditor = 'dates' | 'destination' | 'pace' | 'travellers' | 'modes' | 'stay';

export interface BriefChipView {
  originLabel: string;
  assumed: boolean;
  /** Which inline editor opens (Change), or null: the planner is told instead. */
  editor: BriefEditor | null;
  /** "Right" turns an assumed (or from-your-notes) item into "You said". */
  canConfirm: boolean;
  canRemove: boolean;
}

const EDITORS: Partial<Record<BriefItem['kind'], BriefEditor>> = {
  dates: 'dates',
  destination: 'destination',
  pace: 'pace',
  travellers: 'travellers',
  modes: 'modes',
  stay: 'stay',
};

export function briefChip(item: BriefItem): BriefChipView {
  return {
    originLabel: FACT_SOURCE_LABEL[item.origin] ?? 'Assumed',
    assumed: item.origin === 'assumed',
    editor: item.editable ? (EDITORS[item.kind] ?? null) : null,
    canConfirm: item.origin === 'assumed' || item.origin === 'notes',
    canRemove: item.kind === 'preference' || item.kind === 'constraint',
  };
}

// ── Questions ──────────────────────────────────────────────────────────────

/** A question's deadline in words, against today (local); null when it has none. */
export function deadlineText(deadline: LocalDate | null, today: LocalDate): { text: string; urgent: boolean } | null {
  if (!deadline) return null;
  const days = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return { text: `The deadline was ${dayLabel(deadline)}`, urgent: true };
  if (days === 0) return { text: 'Answer today', urgent: true };
  if (days === 1) return { text: 'Answer by tomorrow', urgent: true };
  return { text: `Answer by ${dayLabel(deadline)}`, urgent: days <= 3 };
}

// ── Research progress ──────────────────────────────────────────────────────

export const STAGE_STATE_LABEL: Record<JobStageState, string> = {
  waiting: 'To do',
  running: 'Working on it',
  done: 'Done',
  failed: 'Did not work',
  skipped: 'Skipped',
};

export interface Progress {
  done: number;
  total: number;
  /** The line being worked on, or the first still to do. */
  current: JobStage | null;
  failed: boolean;
  /** "3 of 5 done", for a screen reader's status line. */
  summary: string;
}

export function progressOf(stages: JobStage[]): Progress {
  const finished = stages.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  const current = stages.find((s) => s.state === 'running') ?? stages.find((s) => s.state === 'waiting') ?? null;
  const failed = stages.some((s) => s.state === 'failed');
  const summary = stages.length ? `${finished} of ${stages.length} done${current ? ` — ${current.label.toLowerCase()}` : ''}` : 'Starting';
  return { done: finished, total: stages.length, current, failed, summary };
}

// ── The research pack browser ──────────────────────────────────────────────

export type PackFilter = 'food' | 'rainy' | 'children' | 'booking' | 'quiet';
export const PACK_FILTERS: ReadonlyArray<{ key: PackFilter; label: string }> = [
  { key: 'food', label: 'Food' },
  { key: 'rainy', label: 'Rainy day' },
  { key: 'children', label: 'Good for children' },
  { key: 'booking', label: 'Needs booking' },
  { key: 'quiet', label: 'Less visited' },
];

const FOOD_KINDS: readonly PackKind[] = ['food', 'cafe', 'gelato'];

export function matchesFilter(p: PackPlace, f: PackFilter): boolean {
  switch (f) {
    case 'food':
      return FOOD_KINDS.includes(p.kind) || p.tags.includes('food');
    case 'rainy':
      return p.indoor === true || p.tags.includes('rainy-day');
    case 'children':
      return p.kidFriendly === true || p.kind === 'kids';
    case 'booking':
      return p.bookingRequired === true || (p.bookAheadDays ?? 0) > 0;
    case 'quiet':
      return p.lessVisited;
  }
}

export interface PackQuery {
  on: PackFilter[];
  neighbourhood: string | null;
  /** Show places turned down as well. */
  showRejected: boolean;
  /** Places hidden on this page ("Not for us"), by id. */
  hidden?: ReadonlySet<string>;
}

/** The places a filter set shows: every filter must match; candidates first, then planned, then turned down. */
export function filterPlaces(places: PackPlace[], q: PackQuery): PackPlace[] {
  const rank = { candidate: 0, planned: 1, rejected: 2 } as const;
  return places
    .filter((p) => (q.showRejected || (p.status !== 'rejected' && !q.hidden?.has(p.id))) && q.on.every((f) => matchesFilter(p, f)) && (!q.neighbourhood || p.neighbourhood === q.neighbourhood))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank[a.p.status] - rank[b.p.status] || a.i - b.i)
    .map(({ p }) => p);
}

export function neighbourhoodsOf(places: PackPlace[]): string[] {
  return [...new Set(places.map((p) => p.neighbourhood).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
}

export const PACK_KIND_LABEL: Record<PackKind, string> = {
  sight: 'Sight',
  museum: 'Museum',
  church: 'Church',
  walk: 'Walk',
  park: 'Park',
  viewpoint: 'Viewpoint',
  market: 'Market',
  food: 'Food',
  cafe: 'Café',
  gelato: 'Gelato',
  kids: 'For children',
  shop: 'Shop',
  experience: 'Experience',
  other: 'Place',
};

/** The facts line on a pack card: duration, cost, indoors, children, booking. */
export function placeFacts(p: PackPlace): string[] {
  const out: string[] = [];
  if (p.durationMin) out.push(p.durationMin >= 90 ? `About ${Math.round(p.durationMin / 30) / 2} hours` : `About ${p.durationMin} min`);
  if (p.costText) out.push(p.costText);
  if (p.indoor === true) out.push('Indoors');
  else if (p.indoor === false) out.push('Outdoors');
  if (p.kidFriendly === true) out.push('Good for children');
  if (p.bookingRequired === true || (p.bookAheadDays ?? 0) > 0) out.push(p.bookAheadDays ? `Book about ${p.bookAheadDays} days ahead` : 'Needs booking');
  else if (p.bookingRequired === false) out.push('No booking needed');
  if (p.lessVisited) out.push('Less visited');
  return out;
}

const km = (a: LatLng, b: LatLng) => {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111.2, (a.lng - b.lng) * 111.2 * k);
};

/**
 * The day a place fits best, for "Add to the plan": the day whose planned
 * stops come nearest it, a little against days already full. Null when the
 * plan has no days.
 */
export function bestDayFor(location: LatLng, days: Array<{ date: LocalDate; stops: Array<Pick<PlannedDay['stops'][number], 'kind' | 'location'>> }>): LocalDate | null {
  let best: { date: LocalDate; score: number } | null = null;
  for (const d of days) {
    const placed = d.stops.filter((s) => s.kind === 'wish' && s.location);
    const near = placed.length ? Math.min(...placed.map((s) => km(location, s.location as LatLng))) : 3;
    const score = near + 0.4 * placed.length;
    if (!best || score < best.score) best = { date: d.date, score };
  }
  return best?.date ?? null;
}

// ── Version history ───────────────────────────────────────────────────────

export interface VersionRow {
  version: number;
  source: string;
  createdAt: string;
  lines: string[];
  /** True when Restore can bring it back; null when the server has not said. */
  restorable: boolean | null;
}

export const VERSION_SOURCE: Record<string, string> = {
  site: 'on the site',
  phone: 'on the phone',
  converse: 'by the planner',
  planner: 'by the planner',
  undo: 'undone',
  proposal: 'a choice',
  question: 'an answer',
  research: 'after research',
};

/** `GET versions` (or the page's own list) as rows, newest first. */
export function versionRows(raw: unknown): VersionRow[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { versions?: unknown }).versions) ? (raw as { versions: unknown[] }).versions : [];
  return list
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as { version?: unknown }).version === 'number')
    .map((v) => ({
      version: v.version as number,
      source: typeof v.source === 'string' ? v.source : '',
      createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
      lines: changeLines(v.changes),
      restorable: typeof v.restorable === 'boolean' ? v.restorable : null,
    }))
    .sort((a, b) => b.version - a.version);
}

// ── The guided start ───────────────────────────────────────────────────────

export interface StartForm {
  destination: string;
  startDate: string;
  endDate: string;
  travellers: Array<{ name: string; age: number | null; personId: string | null }>;
  pace: 'relaxed' | 'normal' | 'packed';
  text: string;
}

/** What is still missing before a trip can start, in words; null when it can. */
export function startProblem(f: Pick<StartForm, 'destination' | 'startDate' | 'endDate'>, maxDays = 31): string | null {
  if (!f.destination.trim()) return 'Say where you’re going.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(f.endDate)) return 'Pick the first and the last day.';
  if (f.endDate < f.startDate) return 'The last day must be on or after the first.';
  const days = Math.round((Date.parse(`${f.endDate}T00:00:00Z`) - Date.parse(`${f.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > maxDays) return `A trip can be at most ${maxDays} days.`;
  return null;
}

/** The guided start's form as the wire's `TripStart`: names trimmed, empty rows dropped, confirmed notes by id. */
export function tripStartFrom(f: StartForm, confirmNotes: string[]): TripStart {
  return {
    destination: f.destination.trim(),
    startDate: f.startDate,
    endDate: f.endDate,
    travellers: f.travellers
      .filter((t) => t.name.trim())
      .map((t) => ({ name: t.name.trim(), age: t.age !== null && Number.isFinite(t.age) && t.age >= 0 ? Math.round(t.age) : null, personId: t.personId ?? null })),
    pace: f.pace,
    confirmNotes,
    text: f.text.trim() || null,
  };
}
