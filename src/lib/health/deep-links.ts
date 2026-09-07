// Where a figure on /health sends you when you click it.
//
// Every number in the nine-section hub is derived from a corpus that already
// has a page of its own — the segment explorer, the activity ledger, the
// planner. Until now the hub said "27 improving" and stopped, and the reader
// who wanted to know WHICH 27 had to go to /health/segments and rebuild the
// filter by hand. This module is the missing half: one tested place that turns
// a figure into the address of the view behind it.
//
// Three rules, and they are the reason this is a module rather than a handful
// of template strings:
//
//  1. THE EMITTER IS THE EXPLORER'S OWN ENCODER. `segmentsHref` builds a
//     `SegmentFilters` and hands it to `filtersToQuery` — the same function
//     `SegmentsView` writes back to the address bar. A second, hand-rolled
//     encoder is how the dashboard ends up emitting `?form=Improving` against
//     a parser that only accepts lowercase, and it fails SILENTLY: the
//     explorer lands unfiltered and looks like it simply had nothing to show.
//     Round-tripping through the real encoder makes that class of bug a test
//     failure instead.
//
//  2. THRESHOLDS ARE IMPORTED, NEVER RETYPED. The gettable link filters on
//     `GETTABLE_GAP_PCT` and `MIN_EFFORTS_FOR_FORM`. If the board's definition
//     of gettable moves, the link that claims to show the board moves with it.
//     The dashboard printing one count and the linked page listing another
//     number of rows is the single most damaging thing this feature could do,
//     because both look authoritative.
//
//  3. GAP IS A PERCENTAGE ON THE WIRE. `segmentForm` stores `gapPct` as a
//     FRACTION (0.03), and the explorer's `numericValue` converts it with
//     `gapPercent()` before any range filter sees it. So the range in the URL
//     is `..3`, not `..0.03`. This is the same ×100 that shipped as a visible
//     bug once already (PR #591, "0.0%" on every row); it is stated here
//     because the two representations meet exactly at this boundary.
import {
  emptyFilters,
  filtersToQuery,
  type SegmentFilters,
  type SortState,
} from '$lib/health/segment-list';
import {
  emptyFilters as emptyActivityFilters,
  filtersToQuery as activityFiltersToQuery,
  validDay,
  type SortState as ActivitySortState,
} from '$lib/health/activity-list';
import {
  GETTABLE_GAP_PCT,
  MIN_EFFORTS_FOR_FORM,
  type FormDirection,
} from '$lib/trails/segments/form';

export const SEGMENTS_PATH = '/health/segments';
export const ACTIVITIES_PATH = '/health/activities';
export const PLAN_PATH = '/health/plan';

/** `?a=b` or `''` — never a bare `?`, which survives a copy-paste as noise. */
function withQuery(path: string, query: string): string {
  return query ? `${path}?${query}` : path;
}

// --- the segment explorer -------------------------------------------------

export interface SegmentsLinkOptions {
  /** Form states to show. Empty means every state. */
  forms?: FormDirection[];
  /** Activity types, as the explorer spells them (its own `types` list). */
  types?: string[];
  /** Free-text name match. */
  name?: string;
  /** Column sort, e.g. `{ key: 'gap', dir: 'asc' }`. */
  sort?: SortState | null;
  /** Inclusive upper bound on the gap to PB, as a PERCENTAGE (3, not 0.03). */
  maxGapPct?: number | null;
  /** Lower bound on effort count. */
  minEfforts?: number | null;
}

/**
 * A link into the segment explorer, pre-filtered.
 *
 * Built through `filtersToQuery` so that whatever this emits, `parseFilters`
 * accepts — the two are tested against each other rather than trusted to agree.
 */
export function segmentsHref(options: SegmentsLinkOptions = {}): string {
  const filters: SegmentFilters = emptyFilters();
  if (options.forms?.length) filters.forms = [...options.forms];
  if (options.types?.length) filters.types = [...options.types];
  if (options.name?.trim()) filters.name = options.name.trim();
  if (options.maxGapPct != null) filters.ranges.gap = { min: null, max: options.maxGapPct };
  if (options.minEfforts != null) filters.ranges.efforts = { min: options.minEfforts, max: null };
  return withQuery(SEGMENTS_PATH, filtersToQuery(filters, options.sort ?? null));
}

/**
 * The explorer filtered to ONE of section F's four taxonomy tiles.
 *
 * Sorted by form ascending, which is the explorer's own first click on that
 * column and puts the ground moving fastest at the top — for `slipping` that
 * is the least-bad row first, so it is overridden to descending, where the
 * worst is. A tile that lands on a list sorted by name has answered "which
 * ones" but not "which one first".
 */
export function taxonomyHref(direction: FormDirection): string {
  return segmentsHref({
    forms: [direction],
    sort: { key: 'form', dir: direction === 'slipping' ? 'desc' : 'asc' },
  });
}

/**
 * The explorer filtered to the gettable board's own three gates: improving
 * direction, inside `GETTABLE_GAP_PCT` of the record, and enough efforts for
 * the form read to exist. Staleness is shown on the board but is not a gate,
 * so it is not one here either — see `isGettable`.
 */
export function gettableHref(): string {
  return segmentsHref({
    forms: ['improving'],
    maxGapPct: GETTABLE_GAP_PCT * 100,
    minEfforts: MIN_EFFORTS_FOR_FORM,
    sort: { key: 'gap', dir: 'asc' },
  });
}

/** One segment's own page. */
export function segmentHref(id: number | string): string {
  return `${SEGMENTS_PATH}/${id}`;
}

// --- the planner ----------------------------------------------------------

/** The sports `/health/plan` offers, in its own order. */
export const PLANNER_SPORTS = ['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk'] as const;
export type PlannerSport = (typeof PLANNER_SPORTS)[number];

export const PLANNER_PREFERENCES = ['any', 'steady', 'spiky'] as const;
export type PlannerPreference = (typeof PLANNER_PREFERENCES)[number];

/**
 * What a "plan this" button hands the planner.
 *
 * Every field is optional: an absent field means "leave the planner's own
 * proposal alone". That matters because the plan page opens on what
 * `proposeSession()` would commission today — a seed that filled in every
 * field would silently discard a live readiness veto (a body under 40 gets a
 * walk proposed instead of a run) in favour of copy written days ago.
 */
export interface PlannerSeed {
  sport?: PlannerSport;
  /** Target distance in kilometres. */
  km?: number;
  prefer?: PlannerPreference;
  /** Metres of climb per kilometre. */
  climbPerKm?: number;
  mode?: 'loop' | 'point';
  /** What sent the reader here — rendered as a line of provenance on the page. */
  from?: string;
  /** The one-line reason, so the planner can say why it opened like this. */
  why?: string;
}

/** Kilometres the planner will accept: its own slider range. */
const KM_MIN = 1;
const KM_MAX = 100;
/** Metres of climb per kilometre — above this is a scramble, not a route. */
const CLIMB_MAX = 120;

function isSport(value: string): value is PlannerSport {
  return (PLANNER_SPORTS as readonly string[]).includes(value);
}

/**
 * Narrow an activity type from anywhere else on the site to a sport the
 * planner actually offers, or null.
 *
 * The rest of the codebase types a sport as `ActivityTypeName`, which is every
 * Strava type there is — swims, rowing, workouts. The planner's select has six
 * options, and openrouteservice has a profile for exactly those. So a caller
 * holding a wider type gets null here rather than a seed the planner would
 * silently ignore.
 */
export function asPlannerSport(value: string | null | undefined): PlannerSport | null {
  const sport = (value ?? '').trim();
  return sport && isSport(sport) ? sport : null;
}

function isPreference(value: string): value is PlannerPreference {
  return (PLANNER_PREFERENCES as readonly string[]).includes(value);
}

/** A number inside `[lo, hi]`, or null — a rejected value never becomes a clamp. */
function boundedNumber(raw: string | null, lo: number, hi: number): number | null {
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < lo || value > hi) return null;
  return value;
}

export function plannerHref(seed: PlannerSeed = {}): string {
  const params = new URLSearchParams();
  if (seed.sport) params.set('sport', seed.sport);
  if (seed.km != null && Number.isFinite(seed.km)) params.set('km', String(Number(seed.km.toFixed(1))));
  if (seed.prefer && seed.prefer !== 'any') params.set('prefer', seed.prefer);
  if (seed.climbPerKm != null && Number.isFinite(seed.climbPerKm)) {
    params.set('climb', String(Math.round(seed.climbPerKm)));
  }
  if (seed.mode) params.set('mode', seed.mode);
  if (seed.from) params.set('from', seed.from);
  if (seed.why) params.set('why', seed.why);
  return withQuery(PLAN_PATH, params.toString());
}

/**
 * Read a seed back off the URL, validating every field.
 *
 * A stale or hand-edited link must land on the planner's own proposal, not on
 * a form seeded with nonsense — so an unknown sport, an out-of-range distance
 * or a junk preference are DROPPED rather than clamped. Clamping would make
 * `?km=9999` open a 100 km plan that nobody asked for, which is worse than
 * ignoring it.
 */
export function parsePlannerSeed(params: URLSearchParams): PlannerSeed {
  const seed: PlannerSeed = {};
  const sport = params.get('sport');
  if (sport && isSport(sport)) seed.sport = sport;
  const km = boundedNumber(params.get('km'), KM_MIN, KM_MAX);
  if (km != null) seed.km = km;
  const prefer = params.get('prefer');
  if (prefer && isPreference(prefer)) seed.prefer = prefer;
  const climb = boundedNumber(params.get('climb'), 0, CLIMB_MAX);
  if (climb != null) seed.climbPerKm = climb;
  const mode = params.get('mode');
  if (mode === 'loop' || mode === 'point') seed.mode = mode;
  const from = params.get('from')?.trim();
  if (from) seed.from = from.slice(0, 80);
  const why = params.get('why')?.trim();
  if (why) seed.why = why.slice(0, 200);
  return seed;
}

/** True when a seed carries anything the planner should act on. */
export function seedIsEmpty(seed: PlannerSeed): boolean {
  return (
    seed.sport == null &&
    seed.km == null &&
    seed.prefer == null &&
    seed.climbPerKm == null &&
    seed.mode == null
  );
}

// --- the activity ledger --------------------------------------------------

export interface ActivitiesLinkOptions {
  /** Activity types as the ledger spells them. */
  types?: string[];
  sort?: ActivitySortState | null;
  /** Inclusive local-day bounds, `YYYY-MM-DD`. Anything else is dropped. */
  from?: string | null;
  to?: string | null;
}

/**
 * A link into the activity ledger, built through the LEDGER's own encoder for
 * the same reason `segmentsHref` uses the explorer's — the ledger spells its
 * day bounds as two params (`from`, `to`) and not as one range, and that is
 * exactly the sort of detail a hand-rolled second emitter gets wrong once and
 * then fails silently at.
 */
export function activitiesHref(options: ActivitiesLinkOptions = {}): string {
  const filters = emptyActivityFilters();
  if (options.types?.length) filters.types = [...options.types];
  filters.from = validDay(options.from);
  filters.to = validDay(options.to);
  return withQuery(ACTIVITIES_PATH, activityFiltersToQuery(filters, options.sort ?? null));
}
