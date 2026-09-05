#!/usr/bin/env node
// Find the drift that makes `drizzle-kit push` stop and ask a question.
//
// WHY THIS EXISTS. `push --force` answers the DATA-LOSS confirmation. It does
// not answer the RENAME one. Drizzle offers a rename only when a single table
// has BOTH a column that schema.ts has and the database lacks AND a column the
// database has and schema.ts lacks — it cannot tell "dropped one, added
// another" from "renamed". Without a TTY that either aborts (dev) or, worse,
// exits 0 having applied nothing (see the release path), which is a green
// deploy with no schema. A table with only additions, or only removals, never
// prompts and is not reported here.
//
// DEPENDENCIES. The CI lint job runs with no `npm ci` and no node_modules —
// see the note above `Lint gates` in ci.yml. So this checks for a database
// FIRST and returns before importing `pg` at all. With no DATABASE_URL it
// prints that it skipped and exits 0: a check that cannot see a database has
// nothing to say, and saying so out loud beats passing silently.

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Read DATABASE_URL from the environment, falling back to an uncommitted .env. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!existsSync('.env')) return null;
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) return null;
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '') || null;
}

/**
 * Every `pgTable('name', { ... })` and the database column names inside it.
 *
 * The body is taken by brace depth rather than a regex, because column configs
 * contain their own braces. Column names are matched as `key: helper('db_name'`
 * — deliberately NOT an allowlist of drizzle helpers, because the first version
 * of this omitted `bigserial` and reported a healthy table as drifted.
 *
 * @param {string} src
 * @returns {Map<string, Set<string>>}
 */
export function tablesFromSchema(src) {
  const tables = new Map();
  const table = /pgTable\(\s*'([a-z0-9_]+)'\s*,\s*\{/g;
  let m;
  while ((m = table.exec(src))) {
    let i = table.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    const body = src.slice(table.lastIndex, i - 1);
    const cols = new Set();
    const col = /(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*\s*\(\s*'([A-Za-z0-9_]+)'/g;
    let c;
    while ((c = col.exec(body))) cols.add(c[2]);
    tables.set(m[1], cols);
  }
  return tables;
}

/**
 * Tables where drizzle would ask "was this renamed?".
 *
 * @param {Map<string, Set<string>>} schemaTables
 * @param {Map<string, Set<string>>} dbTables
 * @returns {Array<{ table: string, added: string[], removed: string[] }>}
 */
export function renameConflicts(schemaTables, dbTables) {
  const out = [];
  for (const [name, want] of schemaTables) {
    const have = dbTables.get(name);
    if (!have) continue; // a table that is missing entirely is created, not renamed
    const added = [...want].filter((c) => !have.has(c));
    const removed = [...have].filter((c) => !want.has(c));
    if (added.length && removed.length) out.push({ table: name, added, removed });
  }
  return out;
}

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.log('check-schema-drift: SKIPPED — no DATABASE_URL, so there is no database to compare against.');
    return 0;
  }

  let pg;
  try {
    ({ default: pg } = await import('pg'));
  } catch {
    console.log('check-schema-drift: SKIPPED — `pg` is not installed in this workspace.');
    return 0;
  }

  const schemaPath = 'src/lib/db/schema.ts';
  if (!existsSync(schemaPath)) {
    console.error(`check-schema-drift: cannot find ${schemaPath}`);
    return 1;
  }
  const schemaTables = tablesFromSchema(readFileSync(schemaPath, 'utf8'));

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (err) {
    // Unreachable is not drift. Blocking a run because a dev box has no
    // Postgres today would make this checker something people route around.
    const why = err instanceof Error ? err.message : String(err);
    console.log(`check-schema-drift: SKIPPED — could not reach the database (${why}).`);
    return 0;
  }

  let rows;
  try {
    ({ rows } = await client.query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'`,
    ));
  } finally {
    await client.end().catch(() => {});
  }

  const dbTables = new Map();
  for (const r of rows) {
    if (!dbTables.has(r.table_name)) dbTables.set(r.table_name, new Set());
    dbTables.get(r.table_name).add(r.column_name);
  }

  const conflicts = renameConflicts(schemaTables, dbTables);
  if (conflicts.length === 0) {
    console.log(
      `check-schema-drift: OK — ${schemaTables.size} tables in schema.ts, none would prompt drizzle for a rename.`,
    );
    return 0;
  }

  console.error('check-schema-drift: FAILED — `drizzle-kit push` will stop and ask about a rename.\n');
  for (const c of conflicts) {
    console.error(`  ${c.table}`);
    console.error(`    in schema.ts, not in the database : ${c.added.join(', ')}`);
    console.error(`    in the database, not in schema.ts : ${c.removed.join(', ')}`);
  }
  console.error(
    [
      '',
      '  `--force` does NOT answer this prompt. Without a TTY the push aborts, or',
      '  exits 0 having applied nothing — a green release with no schema.',
      '',
      '  If the database column is genuinely dead, check it is empty and drop it:',
      '    select count(<column>) from <table>;   -- 0 means nothing is stored',
      '    alter table <table> drop column <column>;',
      '  Take `pg_dump --schema-only` first. Then re-run the push.',
    ].join('\n'),
  );
  return 1;
}

// Run only when invoked as a command. The two functions above are exported so
// they can be unit-tested without a database; importing this file must not
// therefore run the check and call process.exit out from under vitest.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
