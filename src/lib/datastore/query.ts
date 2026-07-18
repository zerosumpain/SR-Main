// $lib/datastore/query.ts
//
// The safe query DSL compiler. Filters are compiled to PARAMETERIZED drizzle
// `sql` fragments — values are NEVER string-concatenated. Paths are validated
// against a strict whitelist and bound as a `::text[]` parameter so the jsonb
// path operators (`#>>`, `#>`, `@>`) can be used without any injection surface.

import { sql, type SQL } from 'drizzle-orm';
import { DatastoreError } from './types';
import type { QueryFilter, QuerySort } from './types';

/** Only these characters may appear in a jsonb path. */
const PATH_RE = /^[a-zA-Z0-9_.]+$/;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Comparison operator → SQL symbol. */
const COMPARATORS: Record<string, string> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

/** Column name for a sort `field`. */
const SORT_FIELDS: Record<string, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  key: 'key',
};

/** Validate a dotted path and split it into non-empty segments. */
function parsePath(path: unknown): string[] {
  if (typeof path !== 'string' || !PATH_RE.test(path)) {
    throw new DatastoreError('validation', `invalid path: ${JSON.stringify(path)}`);
  }
  const segments = path.split('.');
  if (segments.some((s) => s.length === 0)) {
    throw new DatastoreError('validation', `invalid path (empty segment): ${JSON.stringify(path)}`);
  }
  return segments;
}

/** Postgres array-literal string for a set of text elements (fully escaped). */
function toPgArrayLiteral(elements: string[]): string {
  const quoted = elements.map(
    (e) => `"${String(e).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${quoted.join(',')}}`;
}

/** Path literal bound as a `::text[]` parameter (the value, not raw SQL). */
function pathParam(segments: string[]): string {
  return toPgArrayLiteral(segments);
}

/** Compile one filter to a boolean SQL fragment. */
function compileOne(filter: QueryFilter): SQL {
  const segments = parsePath(filter.path);
  const pl = pathParam(segments);

  if (filter.op === 'exists') {
    return sql`data #> ${pl}::text[] IS NOT NULL`;
  }

  if (filter.op === 'contains') {
    return sql`data #> ${pl}::text[] @> ${JSON.stringify(filter.value ?? null)}::jsonb`;
  }

  if (filter.op === 'in') {
    if (!Array.isArray(filter.value)) {
      throw new DatastoreError('validation', 'the "in" operator requires an array value');
    }
    const literal = toPgArrayLiteral(filter.value.map((v) => String(v)));
    return sql`(data #>> ${pl}::text[]) = ANY(${literal}::text[])`;
  }

  const symbol = COMPARATORS[filter.op];
  if (!symbol) {
    throw new DatastoreError('validation', `unknown filter operator: ${JSON.stringify(filter.op)}`);
  }

  // Numeric operand → cast the extracted text to numeric for a true numeric
  // comparison; otherwise compare as text.
  if (typeof filter.value === 'number') {
    return sql`(data #>> ${pl}::text[])::numeric ${sql.raw(symbol)} ${filter.value}`;
  }
  return sql`data #>> ${pl}::text[] ${sql.raw(symbol)} ${String(filter.value ?? '')}`;
}

/**
 * Compile an array of filters into a single AND-joined boolean SQL fragment, or
 * `undefined` when there are no filters (caller omits the WHERE clause).
 */
export function compileFilters(filters: QueryFilter[] | undefined): SQL | undefined {
  if (!filters || filters.length === 0) return undefined;
  const parts = filters.map(compileOne);
  return sql.join(parts, sql` AND `);
}

/** Compile an ORDER BY fragment. Defaults to `updated_at DESC`. */
export function compileSort(sort: QuerySort | undefined): SQL {
  const dir = sort?.dir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');
  if (sort?.field) {
    const col = SORT_FIELDS[sort.field];
    if (!col) throw new DatastoreError('validation', `invalid sort field: ${sort.field}`);
    return sql`${sql.raw(col)} ${dir}`;
  }
  if (sort?.path) {
    const pl = pathParam(parsePath(sort.path));
    return sql`data #>> ${pl}::text[] ${dir}`;
  }
  return sql`updated_at ${dir}`;
}

/** Clamp a requested limit into `[1, 500]`, defaulting when missing/invalid. */
export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Clamp an offset to a non-negative integer. */
export function clampOffset(offset: number | undefined): number {
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset);
}
