// Query shaping for the entities index.
//
// The index is URL-driven: every filter, sort and page number lives in the
// query string, so a view can be linked, bookmarked, and — the part that
// actually matters — re-entered unchanged after a bulk action. That only works
// if parsing is TOTAL: an arbitrary URL has to yield a valid, clamped query
// rather than a 500 or an unbounded table scan. So all of the normalising,
// clamping and page arithmetic lives here, pure and tested, and the DB half at
// the bottom of the file trusts its output without re-checking anything.
//
// The DB half imports `$lib/db` dynamically on purpose. This module is
// colocated with a unit test, and `$lib/db` pulls in `$env/dynamic/private`,
// which does not resolve under vitest — the same reason `analytics/insights.ts`
// takes only a `import type` from `analytics/load.ts`.

// ── Shape ────────────────────────────────────────────────────────────────────

export const ENTITY_SORTS = ['name', 'connections', 'importance', 'recency', 'corroboration'] as const;
export type EntitySort = (typeof ENTITY_SORTS)[number];

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export type ConfirmedFilter = 'all' | 'confirmed' | 'unconfirmed';
export type WatchedFilter = 'all' | 'watched' | 'unwatched';
export type SortDir = 'asc' | 'desc';

export interface EntityQuery {
  /** Free text, matched against name and summary. */
  q: string;
  typeIds: string[];
  confidence: string[];
  confirmed: ConfirmedFilter;
  watched: WatchedFilter;
  /** A lens name, or the sentinel `'none'` for entities with no lens set. */
  lens: string | null;
  sort: EntitySort;
  dir: SortDir;
  /** 1-based. Never trusted: `pageInfo` clamps it against the real total. */
  page: number;
  pageSize: number;
}

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const MIN_PAGE_SIZE = 5;
export const MAX_PAGE_SIZE = 200;
/** Long enough for a real phrase, short enough that the ILIKE stays sane. */
export const MAX_QUERY_LENGTH = 200;
/** Caps the IN-list a caller can force into the SQL. */
export const MAX_FACET_VALUES = 40;

export const DEFAULT_ENTITY_QUERY: EntityQuery = {
  q: '',
  typeIds: [],
  confidence: [],
  confirmed: 'all',
  watched: 'all',
  lens: null,
  sort: 'recency',
  dir: 'desc',
  page: 1,
  pageSize: 50,
};

/**
 * The direction each sort is useful in. Picking a sort should not also require
 * picking a direction — nobody wants the least connected entity first — so the
 * direction defaults per sort and is only carried in the URL when overridden.
 */
export const SORT_DEFAULT_DIR: Record<EntitySort, SortDir> = {
  name: 'asc',
  connections: 'desc',
  importance: 'desc',
  recency: 'desc',
  corroboration: 'desc',
};

export const SORT_LABELS: Record<EntitySort, string> = {
  name: 'Name',
  connections: 'Connections',
  importance: 'Importance',
  recency: 'Recently updated',
  corroboration: 'Corroboration',
};

// ── Parsing ──────────────────────────────────────────────────────────────────

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  // An absent param must fall back, not clamp: `Number(null)` is 0, which would
  // silently turn a missing `pageSize` into the minimum page size.
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Split a repeated-or-CSV param into a bounded, de-duplicated list. */
export function parseList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll(key)) {
    for (const part of raw.split(',')) {
      const value = part.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= MAX_FACET_VALUES) return out;
    }
  }
  return out;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * URL → query. Never throws, never returns anything the SQL builder has to
 * defend against.
 *
 * Also understands the pre-overhaul `typeId` / `limit` / `offset` params, which
 * the entities API has always accepted and which callers outside this repo
 * (jkai's toolchain) still send.
 */
export function parseEntityQuery(params: URLSearchParams): EntityQuery {
  const typeIds = parseList(params, 'types');
  const legacyType = params.get('typeId');
  if (legacyType && !typeIds.includes(legacyType)) typeIds.push(legacyType);

  const confidence = parseList(params, 'confidence').filter((c) =>
    (CONFIDENCE_LEVELS as readonly string[]).includes(c),
  );

  const sort = oneOf(params.get('sort'), ENTITY_SORTS, DEFAULT_ENTITY_QUERY.sort);

  const hasLimit = params.has('limit');
  const pageSize = hasLimit
    ? clampInt(params.get('limit'), MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_ENTITY_QUERY.pageSize)
    : clampInt(params.get('pageSize'), MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_ENTITY_QUERY.pageSize);

  // `offset` only wins when no explicit page was given, so a UI link is never
  // overridden by a stale legacy param sitting in the same URL.
  let page = clampInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER, 1);
  if (!params.has('page') && params.has('offset')) {
    const offset = clampInt(params.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
    page = Math.floor(offset / pageSize) + 1;
  }

  const lensRaw = params.get('lens')?.trim() ?? '';

  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    typeIds,
    confidence,
    confirmed: oneOf(params.get('confirmed'), ['all', 'confirmed', 'unconfirmed'] as const, 'all'),
    watched: oneOf(params.get('watched'), ['all', 'watched', 'unwatched'] as const, 'all'),
    lens: lensRaw ? lensRaw.slice(0, MAX_QUERY_LENGTH) : null,
    sort,
    dir: oneOf(params.get('dir'), ['asc', 'desc'] as const, SORT_DEFAULT_DIR[sort]),
    page,
    pageSize,
  };
}

/**
 * Query → URL. Defaults are omitted so the address bar stays readable and two
 * routes to the same view produce the same string.
 */
export function entityQueryToSearch(query: EntityQuery, overrides: Partial<EntityQuery> = {}): string {
  const q = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (q.q) params.set('q', q.q);
  if (q.typeIds.length) params.set('types', q.typeIds.join(','));
  if (q.confidence.length) params.set('confidence', q.confidence.join(','));
  if (q.confirmed !== 'all') params.set('confirmed', q.confirmed);
  if (q.watched !== 'all') params.set('watched', q.watched);
  if (q.lens) params.set('lens', q.lens);
  if (q.sort !== DEFAULT_ENTITY_QUERY.sort) params.set('sort', q.sort);
  if (q.dir !== SORT_DEFAULT_DIR[q.sort]) params.set('dir', q.dir);
  if (q.pageSize !== DEFAULT_ENTITY_QUERY.pageSize) params.set('pageSize', String(q.pageSize));
  if (q.page > 1) params.set('page', String(q.page));
  return params.toString();
}

/** How many facets are narrowing the list — drives the "clear filters" affordance. */
export function activeFilterCount(query: EntityQuery): number {
  let n = 0;
  if (query.q) n++;
  if (query.typeIds.length) n++;
  if (query.confidence.length) n++;
  if (query.confirmed !== 'all') n++;
  if (query.watched !== 'all') n++;
  if (query.lens) n++;
  return n;
}

/** Toggle a value in a facet list, returning a new list (never mutates). */
export function toggleFacet(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

// ── Page arithmetic ──────────────────────────────────────────────────────────

export interface PageInfo {
  page: number;
  pageSize: number;
  offset: number;
  total: number;
  totalPages: number;
  /** 1-based inclusive display range. Both 0 when there is nothing to show. */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Resolve the requested page against the real total.
 *
 * Clamping happens HERE, after counting, rather than at parse time: the common
 * way to land past the end is to bulk-delete or bulk-confirm your way off the
 * last page, and answering that with an empty screen and no explanation is the
 * one behaviour guaranteed to make someone think the action destroyed more than
 * it did. Clamped, you land on the new last page instead.
 */
export function pageInfo(total: number, query: Pick<EntityQuery, 'page' | 'pageSize'>): PageInfo {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const pageSize = clampInt(query.pageSize, MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_ENTITY_QUERY.pageSize);
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const page = clampInt(query.page, 1, totalPages, 1);
  const offset = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    offset,
    total: safeTotal,
    totalPages,
    from: safeTotal === 0 ? 0 : offset + 1,
    to: Math.min(offset + pageSize, safeTotal),
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/**
 * Escape a user string for use inside an ILIKE pattern.
 *
 * Without this a search for `100%` matches every row and `a_b` matches `axb` —
 * cheap to miss, and it silently turns the search box into a wildcard console.
 */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

// ── SQL (dynamic `$lib/db` import — see the file header) ─────────────────────

/**
 * One clickable source behind an entity. `href` links to the item itself where
 * the note's metadata identifies one (a Gmail permalink, a deep dive) and to
 * the extracted note otherwise — `direct` says which you are getting, because
 * "the email" and "what we extracted from the email" are different promises.
 */
export interface SourceRef {
  noteId: string;
  title: string;
  /** `intel_notes.source` — email, file, chat, research, web. */
  source: string;
  href: string;
  direct: boolean;
  /** Observation time where anything recorded one, ingest time otherwise. */
  at: Date;
  observed: boolean;
}

export interface EntityRow {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  typeIcon: string;
  typeColor: string;
  summary: string | null;
  confidence: string;
  confirmed: boolean;
  watched: boolean;
  lens: string | null;
  corroboration: number;
  confidenceScore: number | null;
  sourceGrade: string | null;
  createdAt: Date;
  updatedAt: Date;
  noteCount: number;
  relationshipCount: number;
  /** Where this entity was first extracted. Null on rows predating the column. */
  firstSource: SourceRef | null;
  /** The most recently observed source asserting it — null when it has none. */
  latestSource: SourceRef | null;
  /** Sources other than the origin: how much has landed since. */
  laterSourceCount: number;
}

export interface EntityPage {
  entities: EntityRow[];
  page: PageInfo;
  /** typeId → count under the current filters ignoring the type facet itself. */
  typeCounts: Record<string, number>;
  /** Distinct non-null lens values present in the graph. */
  lensValues: string[];
}

/** Every filter except the type facet — that one is excluded when counting facets. */
