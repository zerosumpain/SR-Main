import { describe, it, expect } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphNodes } from '$lib/db/schema';
import { pgTextArray } from '$lib/db/sql-array';

/*
 * The liveness statements are the only place in codegraph that compares a
 * column against a few thousand values at once, and the first version of them
 * 500'd the entire tree pass in production.
 *
 * Drizzle binds a JS array as a TUPLE — `<> ALL(($4, $5, $6, …))` — which
 * Postgres reads as a row expression, not an array, and rejects. The failure is
 * invisible to a type-checker and to every test that does not reach a database,
 * so it is asserted here at the SQL level: no database, no fixtures, just what
 * the driver would actually send.
 */
const PATHS = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

describe('liveness binds an array, not a tuple', () => {
  it('marks the tree live with = ANY(::text[])', () => {
    const { sql: text, params } = db
      .update(codegraphNodes)
      .set({ existsOnHead: true })
      .where(and(
        eq(codegraphNodes.repo, 'SR-Main'),
        sql`${codegraphNodes.canonicalPath} = ANY(${pgTextArray(PATHS)}::text[])`,
      ))
      .toSQL();

    expect(text).toContain('= ANY($');
    expect(text).toContain('::text[]');
    // One parameter for the whole list — a tuple expansion would place one per
    // path and is exactly what broke.
    expect(text).not.toMatch(/\$\d+, \$\d+, \$\d+/);
    expect(params).toContain('{"src/a.ts","src/b.ts","src/c.ts"}');
  });

  it('retires everything outside the tree with <> ALL(::text[])', () => {
    const { sql: text } = db
      .update(codegraphNodes)
      .set({ existsOnHead: false })
      .where(and(
        eq(codegraphNodes.repo, 'SR-Main'),
        sql`${codegraphNodes.canonicalPath} <> ALL(${pgTextArray(PATHS)}::text[])`,
      ))
      .toSQL();

    expect(text).toContain('<> ALL($');
    expect(text).toContain('::text[]');
    expect(text).not.toMatch(/\$\d+, \$\d+, \$\d+/);
  });

  it('escapes a path that could break out of the array literal', () => {
    expect(pgTextArray(['a"b.ts', 'c\\d.ts'])).toBe('{"a\\"b.ts","c\\\\d.ts"}');
  });
});
