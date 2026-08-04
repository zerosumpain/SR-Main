import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { pgTextArray } from '$lib/db/sql-array';

const dialect = new PgDialect();
const render = (chunk: ReturnType<typeof sql>) => dialect.sqlToQuery(chunk);

describe('pgTextArray', () => {
  it('builds a Postgres array literal', () => {
    expect(pgTextArray(['a', 'b'])).toBe('{"a","b"}');
  });

  it('quotes elements so separators inside a value survive', () => {
    expect(pgTextArray(['a,b', 'c}d', '{e'])).toBe('{"a,b","c}d","{e"}');
  });

  it('escapes quotes and backslashes', () => {
    expect(pgTextArray(['say "hi"', 'back\\slash'])).toBe('{"say \\"hi\\"","back\\\\slash"}');
  });

  it('renders an empty list as an empty array literal, not a bare {}', () => {
    expect(pgTextArray([])).toBe('{}');
  });
});

describe('binding an array into a raw sql template', () => {
  // The regression this whole module exists for. Interpolating a JS array
  // directly expands to a parameter LIST, which Postgres reads as a row
  // constructor and refuses to cast: "cannot cast type record to text[]".
  it('a raw JS array expands to a row constructor — the broken form', () => {
    const { sql: text, params } = render(sql`WHERE id = ANY(${['x', 'y']}::text[])`);
    expect(text).toContain('($1, $2)');
    expect(params).toEqual(['x', 'y']);
  });

  it('pgTextArray binds exactly one parameter that can be cast', () => {
    const { sql: text, params } = render(sql`WHERE id = ANY(${pgTextArray(['x', 'y'])}::text[])`);
    expect(text).toContain('ANY($1::text[])');
    expect(text).not.toContain('$2');
    expect(params).toEqual(['{"x","y"}']);
  });

  it('holds for a single-element array, where the broken form looks correct', () => {
    // ANY(($1)::text[]) happens to be valid SQL, so a one-element smoke test
    // passes against the broken binding. Two elements is the minimum that
    // reproduces it — which is why this bug reached production.
    const { sql: text, params } = render(sql`WHERE id = ANY(${pgTextArray(['solo'])}::text[])`);
    expect(text).toContain('ANY($1::text[])');
    expect(params).toEqual(['{"solo"}']);
  });
});
