import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameConflicts, tablesFromSchema } from '../../scripts/check-schema-drift.mjs';

describe('tablesFromSchema', () => {
  it('reads the database column names, not the TypeScript keys', () => {
    const src = `
      export const thing = pgTable('thing', {
        id: text('id').primaryKey(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
      });`;
    expect([...tablesFromSchema(src).get('thing')!]).toEqual(['id', 'created_at']);
  });

  it('matches any helper, not a hand-written list of them', () => {
    // The first version of this omitted `bigserial` and reported a healthy
    // table as drifted, so the matcher is shape-based on purpose.
    const src = `
      export const t = pgTable('t', {
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        vec: vector('embedding', { dimensions: 1536 }),
        odd: someFutureHelper('odd_col'),
      });`;
    expect([...tablesFromSchema(src).get('t')!].sort()).toEqual(['embedding', 'id', 'odd_col']);
  });

  it('takes the table body by brace depth, so nested config cannot end it early', () => {
    const src = `
      export const t = pgTable('t', {
        a: text('a').default(sql\`'{}'::jsonb\`),
        b: jsonb('b').$type<{ nested: { deep: true } }>().notNull(),
        c: text('c'),
      }, (t) => [index('t_idx').on(t.a)]);`;
    const cols = tablesFromSchema(src).get('t')!;
    expect([...cols].sort()).toEqual(['a', 'b', 'c']);
    // The index in the second argument is not a column.
    expect(cols.has('t_idx')).toBe(false);
  });

  it('finds every table in a file, not just the first', () => {
    const src = `
      export const one = pgTable('one', { id: text('id') });
      export const two = pgTable('two', { id: text('id'), extra: text('extra') });`;
    expect([...tablesFromSchema(src).keys()]).toEqual(['one', 'two']);
  });
});

describe('renameConflicts', () => {
  const schema = new Map([['t', new Set(['id', 'degree'])]]);

  it('reports a table with BOTH an added and a removed column', () => {
    // This pair, and only this pair, is what makes drizzle ask about a rename.
    const db = new Map([['t', new Set(['id', 'embedding'])]]);
    expect(renameConflicts(schema, db)).toEqual([
      { table: 't', added: ['degree'], removed: ['embedding'] },
    ]);
  });

  it('is silent when a table only GAINS columns', () => {
    const db = new Map([['t', new Set(['id'])]]);
    expect(renameConflicts(schema, db)).toEqual([]);
  });

  it('is silent when a table only LOSES columns', () => {
    const s = new Map([['t', new Set(['id'])]]);
    const db = new Map([['t', new Set(['id', 'gone'])]]);
    expect(renameConflicts(s, db)).toEqual([]);
  });

  it('ignores a table the database does not have at all', () => {
    // A missing table is created outright — drizzle never asks about it.
    expect(renameConflicts(schema, new Map())).toEqual([]);
  });

  it('ignores a table the database has and schema.ts does not', () => {
    const db = new Map([
      ['t', new Set(['id', 'degree'])],
      ['legacy', new Set(['id'])],
    ]);
    expect(renameConflicts(schema, db)).toEqual([]);
  });
});

describe('the command itself', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const script = path.join(ROOT, 'scripts/check-schema-drift.mjs');

  it('SKIPS and passes with no database, which is how the CI lint job runs it', () => {
    // That job has no `npm ci` and no node_modules — see the note above
    // `Lint gates` in ci.yml. If this ever exits non-zero, or reaches the `pg`
    // import, every PR turns red on a check that cannot see a database anyway.
    const dir = mkdtempSync(path.join(tmpdir(), 'drift-'));
    try {
      mkdirSync(path.join(dir, 'src/lib/db'), { recursive: true });
      writeFileSync(
        path.join(dir, 'src/lib/db/schema.ts'),
        "export const t = pgTable('t', { id: text('id') });",
      );
      const env = { ...process.env };
      delete env.DATABASE_URL;
      const out = execFileSync(process.execPath, [script], {
        cwd: dir,
        env,
        encoding: 'utf8',
      });
      expect(out).toMatch(/SKIPPED/);
      expect(out).toMatch(/no DATABASE_URL/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
