import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { compileFilters, compileSort, clampLimit } from './query';
import { DatastoreError } from './types';
import type { QueryFilter } from './types';

const dialect = new PgDialect();
function render(frag: SQL): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(frag);
  return { sql: q.sql, params: q.params };
}
function one(filters: QueryFilter[]) {
  const frag = compileFilters(filters);
  expect(frag).toBeDefined();
  return render(frag as SQL);
}

describe('compileFilters — operator matrix', () => {
  it('eq on text uses #>> path array and parameterizes the value', () => {
    const { sql, params } = one([{ path: 'status', op: 'eq', value: 'open' }]);
    expect(sql).toContain('#>> $1::text[]');
    expect(sql).toContain('= $2');
    expect(params).toEqual(['{"status"}', 'open']);
  });

  it('eq on a numeric operand casts the extracted value to numeric', () => {
    const { sql, params } = one([{ path: 'count', op: 'eq', value: 5 }]);
    expect(sql).toContain('::text[])::numeric');
    expect(sql).toContain('= $2');
    expect(params).toEqual(['{"count"}', 5]);
  });

  it('supports ne / gt / gte / lt / lte comparators', () => {
    expect(one([{ path: 'a', op: 'ne', value: 'x' }]).sql).toContain('<> $2');
    expect(one([{ path: 'a', op: 'gt', value: 1 }]).sql).toContain('> $2');
    expect(one([{ path: 'a', op: 'gte', value: 1 }]).sql).toContain('>= $2');
    expect(one([{ path: 'a', op: 'lt', value: 1 }]).sql).toContain('< $2');
    expect(one([{ path: 'a', op: 'lte', value: 1 }]).sql).toContain('<= $2');
  });

  it('contains compiles to the jsonb @> containment operator', () => {
    const { sql, params } = one([{ path: 'tags', op: 'contains', value: { x: 1 } }]);
    expect(sql).toContain('#> $1::text[] @> $2::jsonb');
    expect(params[0]).toBe('{"tags"}');
    expect(params[1]).toBe(JSON.stringify({ x: 1 }));
  });

  it('exists compiles to IS NOT NULL', () => {
    const { sql } = one([{ path: 'email', op: 'exists' }]);
    expect(sql).toContain('#> $1::text[] IS NOT NULL');
  });

  it('in compiles to = ANY(::text[])', () => {
    const { sql, params } = one([{ path: 'status', op: 'in', value: ['a', 'b'] }]);
    expect(sql).toContain('= ANY($2::text[])');
    expect(params).toEqual(['{"status"}', '{"a","b"}']);
  });

  it('nested dotted paths become multi-segment path arrays', () => {
    const { params } = one([{ path: 'a.b.c', op: 'eq', value: 'z' }]);
    expect(params[0]).toBe('{"a","b","c"}');
  });

  it('joins multiple filters with AND', () => {
    const { sql } = one([
      { path: 'a', op: 'eq', value: '1' },
      { path: 'b', op: 'eq', value: '2' },
    ]);
    expect(sql).toContain(' AND ');
  });

  it('returns undefined when there are no filters', () => {
    expect(compileFilters(undefined)).toBeUndefined();
    expect(compileFilters([])).toBeUndefined();
  });
});

describe('compileFilters — path sanitization (injection defence)', () => {
  const bad = ["a'; DROP TABLE datastore_records; --", 'a-b', '', 'a b', 'a;b', 'a}b', '"a"'];
  for (const path of bad) {
    it(`rejects path ${JSON.stringify(path)} with a validation error`, () => {
      expect(() => compileFilters([{ path, op: 'eq', value: 'x' }])).toThrow(DatastoreError);
      try {
        compileFilters([{ path, op: 'eq', value: 'x' }]);
      } catch (e) {
        expect((e as DatastoreError).code).toBe('validation');
      }
    });
  }

  it('accepts underscores, digits and dots', () => {
    expect(() => compileFilters([{ path: 'a_1.b2.c', op: 'eq', value: 'x' }])).not.toThrow();
  });

  it('rejects in without an array value', () => {
    expect(() => compileFilters([{ path: 'a', op: 'in', value: 'notarray' }])).toThrow(DatastoreError);
  });
});

describe('compileSort', () => {
  it('orders by a known field column', () => {
    const { sql } = render(compileSort({ field: 'createdAt', dir: 'desc' }) as SQL);
    expect(sql).toContain('created_at');
    expect(sql.toLowerCase()).toContain('desc');
  });

  it('orders by a jsonb path when path is given', () => {
    const { sql, params } = render(compileSort({ path: 'score', dir: 'asc' }) as SQL);
    expect(sql).toContain('#>> $1::text[]');
    expect(params[0]).toBe('{"score"}');
    expect(sql.toLowerCase()).toContain('asc');
  });

  it('rejects an invalid sort path', () => {
    expect(() => compileSort({ path: "a'; DROP", dir: 'asc' })).toThrow(DatastoreError);
  });
});

describe('clampLimit', () => {
  it('caps limit at 500', () => {
    expect(clampLimit(9999)).toBe(500);
  });
  it('passes valid limits through', () => {
    expect(clampLimit(50)).toBe(50);
  });
  it('falls back to the default for missing/invalid limits', () => {
    expect(clampLimit(undefined)).toBeGreaterThan(0);
    expect(clampLimit(-3)).toBeGreaterThan(0);
    expect(clampLimit(0)).toBeGreaterThan(0);
  });
});
