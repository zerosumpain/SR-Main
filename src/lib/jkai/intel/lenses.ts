// Lenses — a named perspective, saved once and reapplied everywhere.
//
// Every intel surface grew its own ad-hoc filter bar, so "the work stuff" had
// to be re-specified on the graph, on the entities index and again in chat, and
// none of the three agreed. A lens is that specification written down ONCE:
// a set of filters plus the standing instructions jkai should carry while it is
// active, addressed by slug so it can live in a URL.
//
// Three rules shape everything below.
//
//  1. An EMPTY lens matches everything. This is the whole reason `matchesLens`
//     is pure and exhaustively tested: the natural way to write a filter chain
//     ("start with false, OR in each match") turns a lens with no filters into
//     a lens that hides the entire graph, and that failure is invisible until
//     someone saves a lens with one field set and wonders where their data went.
//
//  2. A filter that CANNOT be evaluated is skipped, not failed. A candidate
//     whose `sources` were never loaded is not "an entity with no sources" —
//     answering an unanswerable question with "no" empties the view for a
//     reason nobody can see. Absent evidence skips; present-but-empty fails.
//
//  3. SQL does what SQL can, and says so when it cannot. Community membership
//     comes out of Louvain, not a column, so `buildLensFilter` hands back the
//     community ids separately with `needsAnalysis` set rather than pretending
//     a WHERE clause covers them.
//
// DB access lives in ./lenses.server.ts, NOT here. This module is imported by
// timeline/+page.svelte, and anything a client component can reach drags its
// whole import graph into the browser bundle — including `$lib/db`, which reads
// `$env/dynamic/private` and fails the production build. A dynamic
// `await import('$lib/db')` does NOT prevent that; Rollup still walks the graph.
// The `.server.ts` suffix is the real guard: SvelteKit makes importing it from
// client code a build error.
//
// (Historic note: `$lib/db` was imported dynamically on purpose because it pulls in
// `$env/dynamic/private`, which does not resolve under vitest, and the pure
// half of this file is unit-tested. Same reason as entity-query.ts.
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { intelEntities, intelLenses, type IntelLens } from '$lib/db/schema';
import { escapeLike } from './entity-query';

// ── Shape ────────────────────────────────────────────────────────────────────

/** The two halves of a life. Deliberately closed — a free-text scope would just
 *  become a second, worse type system. */
export const LENS_SCOPES = ['professional', 'personal'] as const;
export type LensScope = (typeof LENS_SCOPES)[number];

export interface LensFilters {
  typeIds: string[];
  /** `intel_notes.source` values — where the evidence came from. */
  sources: string[];
  lens: LensScope | null;
  /** Louvain community indices. Not a column — see rule 3 in the header. */
  communityIds: number[];
  /** 0..1 against `confidence_score`. Null means "no floor". */
  minConfidence: number | null;
  /** Free text over name, aliases and summary. */
  query: string;
}

export const EMPTY_LENS_FILTERS: LensFilters = {
  typeIds: [],
  sources: [],
  lens: null,
  communityIds: [],
  minConfidence: null,
  query: '',
};

/** Caps the IN-list a saved lens can force into the SQL. */
export const MAX_FACET_VALUES = 40;
export const MAX_QUERY_LENGTH = 200;
export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_INSTRUCTIONS_LENGTH = 4000;

/**
 * What a lens is applied TO. Every field past `id` is optional because the
 * callers hold different amounts of the entity: the entities index has the row,
 * the graph has the analysed node, the client has whatever the payload carried.
 * Undefined means "not loaded" and skips its filter (rule 2).
 */
export interface LensCandidate {
  id: string;
  name?: string;
  aliases?: string[];
  summary?: string | null;
  typeId?: string | null;
  lens?: string | null;
  confidenceScore?: number | null;
  /** Distinct `intel_notes.source` values this entity was seen in. */
  sources?: string[];
  /** Louvain community index, or null when the entity is in no community. */
  community?: number | null;
}

// ── Parsing (pure, total) ────────────────────────────────────────────────────

function stringList(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const v = String(value ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_FACET_VALUES) break;
  }
  return out;
}

function numberList(raw: unknown): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of stringList(raw)) {
    const n = Number(value);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(Math.trunc(n));
  }
  return out;
}

/**
 * Anything → a valid `LensFilters`. Never throws: a lens row is jsonb written
 * by an API, a migration or a human, and a malformed one must degrade to "no
 * filter" rather than 500 every view that reads it.
 */
export function normaliseLensFilters(raw: unknown): LensFilters {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const scope = String(src.lens ?? '').trim().toLowerCase();
  const minRaw = Number(src.minConfidence);

  return {
    typeIds: stringList(src.typeIds),
    sources: stringList(src.sources),
    lens: (LENS_SCOPES as readonly string[]).includes(scope) ? (scope as LensScope) : null,
    communityIds: numberList(src.communityIds),
    // A floor of 0 excludes nothing but still costs a clause, so it collapses
    // to "no floor" — which keeps `isEmptyLensFilters` honest.
    minConfidence:
      Number.isFinite(minRaw) && minRaw > 0 ? Math.min(1, minRaw) : null,
    query: String(src.query ?? '').trim().slice(0, MAX_QUERY_LENGTH),
  };
}

export function isEmptyLensFilters(filters: LensFilters): boolean {
  return (
    filters.typeIds.length === 0 &&
    filters.sources.length === 0 &&
    filters.lens === null &&
    filters.communityIds.length === 0 &&
    filters.minConfidence === null &&
    filters.query === ''
  );
}

/** How many facets are narrowing — drives the "clear" affordance in the picker. */
export function activeLensFilterCount(filters: LensFilters): number {
  let n = 0;
  if (filters.typeIds.length) n++;
  if (filters.sources.length) n++;
  if (filters.lens) n++;
  if (filters.communityIds.length) n++;
  if (filters.minConfidence !== null) n++;
  if (filters.query) n++;
  return n;
}

/** One line describing the narrowing, for the picker and for insight text. */
export function describeLensFilters(filters: LensFilters): string {
  const parts: string[] = [];
  if (filters.lens) parts.push(filters.lens);
  if (filters.typeIds.length) parts.push(`${filters.typeIds.length} type${filters.typeIds.length > 1 ? 's' : ''}`);
  if (filters.sources.length) parts.push(`source: ${filters.sources.join(', ')}`);
  if (filters.communityIds.length) parts.push(`${filters.communityIds.length} cluster${filters.communityIds.length > 1 ? 's' : ''}`);
  if (filters.minConfidence !== null) parts.push(`confidence ≥ ${filters.minConfidence.toFixed(2)}`);
  if (filters.query) parts.push(`“${filters.query}”`);
  return parts.length ? parts.join(' · ') : 'everything';
}

// ── Matching (pure) ──────────────────────────────────────────────────────────

function textHit(candidate: LensCandidate, needle: string): boolean {
  const q = needle.toLowerCase();
  if (candidate.name && candidate.name.toLowerCase().includes(q)) return true;
  if (candidate.summary && candidate.summary.toLowerCase().includes(q)) return true;
  return (candidate.aliases ?? []).some((a) => String(a).toLowerCase().includes(q));
}

/**
 * Does this entity belong in the lens?
 *
 * Every filter is a conjunction and every absent filter is a no-op, so an empty
 * lens matches everything. `undefined` on the candidate means the caller never
 * loaded that field and the corresponding filter is skipped; `null` / `[]` mean
 * the entity genuinely has no value and the filter rejects it.
 */
export function matchesLens(candidate: LensCandidate, filters: LensFilters): boolean {
  if (filters.typeIds.length && candidate.typeId !== undefined) {
    if (!candidate.typeId || !filters.typeIds.includes(candidate.typeId)) return false;
  }

  if (filters.lens && candidate.lens !== undefined) {
    if (candidate.lens !== filters.lens) return false;
  }

  if (filters.sources.length && candidate.sources !== undefined) {
    if (!candidate.sources.some((s) => filters.sources.includes(s))) return false;
  }

  if (filters.communityIds.length && candidate.community !== undefined) {
    if (candidate.community === null || !filters.communityIds.includes(candidate.community)) return false;
  }

  if (filters.minConfidence !== null && candidate.confidenceScore !== undefined) {
    // An ungraded entity fails a confidence floor. "At least 0.6 confident" is
    // a claim about evidence, and `null` is the absence of that evidence — the
    // opposite of clearing the bar.
    if (candidate.confidenceScore === null || candidate.confidenceScore < filters.minConfidence) {
      return false;
    }
  }

  if (filters.query) {
    // Text is the one filter with no "not loaded" state: a candidate with no
    // name, summary or aliases has nothing to match, so it fails.
    if (!textHit(candidate, filters.query)) return false;
  }

  return true;
}

// ── SQL plan ─────────────────────────────────────────────────────────────────

export interface LensFilterPlan {
  /** True when nothing narrows — callers can skip filtering entirely. */
  empty: boolean;
  /** Conditions over `intel_entities`. Spread into a drizzle `and(...)`. */
  conditions: SQL[];
  /** Louvain indices the SQL could not express — post-filter with these. */
  communityIds: number[];
  /** True when `conditions` alone does NOT decide membership. */
  needsAnalysis: boolean;
  summary: string;
  /** The same decision as `conditions`, for rows already in memory. */
  matches: (candidate: LensCandidate) => boolean;
}

/**
 * Filters → the description a caller applies.
 *
 * Merged entities are excluded unconditionally: an alias resolved into a
 * survivor is not a second entity, and counting it would inflate every lens.
 */
export function buildLensFilter(filters: LensFilters): LensFilterPlan {
  const conditions: SQL[] = [isNull(intelEntities.mergedIntoId)];

  if (filters.typeIds.length) {
    conditions.push(inArray(intelEntities.typeId, filters.typeIds));
  }

  if (filters.lens) {
    conditions.push(eq(intelEntities.lens, filters.lens));
  }

  if (filters.minConfidence !== null) {
    // NULL >= x is NULL, so ungraded rows drop out — matching `matchesLens`.
    conditions.push(sql`${intelEntities.confidenceScore} >= ${filters.minConfidence}`);
  }

  if (filters.query) {
    const pattern = `%${escapeLike(filters.query)}%`;
    conditions.push(
      or(
        ilike(intelEntities.name, pattern),
        ilike(intelEntities.summary, pattern),
        // Aliases are jsonb; casting to text is a loose but adequate contains —
        // the in-memory path checks each alias properly.
        sql`${intelEntities.aliases}::text ilike ${pattern}`,
      ) as SQL,
    );
  }

  if (filters.sources.length) {
    const list = sql.join(
      filters.sources.map((s) => sql`${s}`),
      sql`, `,
    );
    conditions.push(sql`exists (
      select 1
      from intel_note_entities ne
      join intel_notes n on n.id = ne.note_id
      where ne.entity_id = ${intelEntities.id} and n.source in (${list})
    )`);
  }

  return {
    empty: isEmptyLensFilters(filters),
    conditions,
    communityIds: filters.communityIds,
    needsAnalysis: filters.communityIds.length > 0,
    summary: describeLensFilters(filters),
    matches: (candidate) => matchesLens(candidate, filters),
  };
}

// ── Growth (pure) ────────────────────────────────────────────────────────────

export interface LensGrowth {
  count: number;
  previousCount: number | null;
  delta: number;
  /** The result set got bigger since the last run. */
  grew: boolean;
  /** No previous count — a first run has no delta worth reporting. */
  firstRun: boolean;
}

/**
 * Compare a live count with the last one.
 *
 * A first run reports `delta: 0`, never `delta: count`. Treating the baseline
 * as growth is how a newly saved live query fires an alert about every entity
 * that already existed, the morning after it is created.
 */
export function lensGrowth(count: number, lastCount: number | null | undefined): LensGrowth {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const firstRun = lastCount === null || lastCount === undefined || !Number.isFinite(lastCount);
  const previousCount = firstRun ? null : Math.max(0, Math.trunc(lastCount as number));
  const delta = firstRun ? 0 : safeCount - (previousCount as number);
  return { count: safeCount, previousCount, delta, grew: delta > 0, firstRun };
}

// ── Time range — the brush's half of the same idea ───────────────────────────
//
// A brushed date range is a filter applied across views exactly like a lens is,
// so it lives here, pure and tested, rather than inside the chart component
// where nothing could check the interval arithmetic.

export interface TimeRange {
  /** Epoch ms, inclusive. Null means "unbounded". */
  start: number | null;
  end: number | null;
}

export const FULL_RANGE: TimeRange = { start: null, end: null };

export const DAY_MS = 86_400_000;

export function isFullRange(range: TimeRange): boolean {
  return range.start === null && range.end === null;
}

/** Swaps inverted bounds — dragging right-to-left is the same selection. */
export function normaliseRange(range: TimeRange): TimeRange {
  const { start, end } = range;
  if (start !== null && end !== null && start > end) return { start: end, end: start };
  return { start, end };
}

/** `YYYY-MM-DD` → UTC midnight, or null. Anything unparseable is "unbounded". */
export function parseDateInput(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${String(value).trim().slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function toDateInput(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The keyboard fallback's two text fields → a range.
 *
 * The end date is pushed to the last instant of that day. A user who types
 * 1–7 July means seven days; a naive parse gives them six and a bit, and the
 * event on the 7th silently vanishes.
 */
export function parseRangeInputs(startValue: string, endValue: string): TimeRange {
  const start = parseDateInput(startValue);
  const endDay = parseDateInput(endValue);
  return normaliseRange({ start, end: endDay === null ? null : endDay + DAY_MS - 1 });
}

export interface TimelinePoint {
  id: string;
  /** Date text as stored — `YYYY-MM-DD` or a full ISO stamp. */
  date: string;
  dateEnd?: string | null;
  entityId?: string | null;
}

/** Stored date text → epoch ms, or null when it is not a date at all. */
export function eventTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = String(value).trim();
  // A bare `YYYY-MM-DD` is parsed as UTC by spec; anything else is left to the
  // engine. Both land on the same axis because the axis is also UTC.
  const ms = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Does this event touch the range?
 *
 * Interval OVERLAP, not point containment: an event with a `dateEnd` spanning
 * the brushed window belongs in it even though neither endpoint does, and a
 * multi-month programme is exactly the kind of event someone brushes for.
 */
export function eventInRange(event: TimelinePoint, range: TimeRange): boolean {
  const from = eventTime(event.date);
  if (from === null) return false;
  const to = eventTime(event.dateEnd) ?? from;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const { start, end } = normaliseRange(range);
  if (start !== null && hi < start) return false;
  if (end !== null && lo > end) return false;
  return true;
}

export function eventsInRange<T extends TimelinePoint>(events: T[], range: TimeRange): T[] {
  if (isFullRange(range)) return events;
  return events.filter((e) => eventInRange(e, range));
}

/** The entity ids a brushed range implicates — this is what drives the graph. */
export function entityIdsInRange(events: TimelinePoint[], range: TimeRange): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of eventsInRange(events, range)) {
    const id = e.entityId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The full extent of a set of events, for the axis domain. */
export function eventExtent(events: TimelinePoint[]): TimeRange {
  let lo: number | null = null;
  let hi: number | null = null;
  for (const e of events) {
    const from = eventTime(e.date);
    if (from === null) continue;
    const to = eventTime(e.dateEnd) ?? from;
    lo = lo === null ? Math.min(from, to) : Math.min(lo, from, to);
    hi = hi === null ? Math.max(from, to) : Math.max(hi, from, to);
  }
  // A single-day extent has zero width, which would collapse the scale; pad it
  // to a day so the mark lands mid-axis instead of on the edge.
  if (lo !== null && hi !== null && lo === hi) return { start: lo - DAY_MS / 2, end: hi + DAY_MS / 2 };
  return { start: lo, end: hi };
}

// ── Slugs ────────────────────────────────────────────────────────────────────

/** Slug body: lowercase, hyphenated, never empty. */
export function slugify(name: string): string {
  const base = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return base || 'lens';
}

/** Pick the first free slug given the ones already taken. Pure, so it is tested. */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
