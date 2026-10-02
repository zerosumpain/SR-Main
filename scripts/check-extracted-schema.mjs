#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stripBlockComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

/** Tables declared in a named Postgres schema: `x = pgSchema('s')`, then `x.table('t', ...)`. */
function schemaTables(source) {
  const text = stripBlockComments(source);
  const schemas = new Map([...text.matchAll(/^export\s+const\s+(\w+)\s*=\s*pgSchema\(\s*['"]([^'"]+)['"]\s*\)/gm)]
    .map((m) => [m[1], m[2]]));
  return [...text.matchAll(/^export\s+const\s+\w+\s*=\s*(\w+)\.table\(\s*['"]([^'"]+)['"]/gm)]
    .filter((m) => schemas.has(m[1])).map((m) => ({ schema: schemas.get(m[1]), table: m[2] }));
}

/** The schemas drizzle-kit push manages, from drizzle.config.ts; null when unset. */
function pushedSchemas(config) {
  const match = stripBlockComments(config).replace(/\/\/[^\n]*/g, '').match(/schemaFilter\s*:\s*\[([^\]]*)\]/);
  return match ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : null;
}

/**
 * Minimum table-retention check; column compatibility still needs migration review.
 *
 * Tables an application owns in its own Postgres schema (`ownedSchema` /
 * `ownedTables`) are the inverse case: Main must NOT manage them. A public
 * declaration would make `drizzle-kit push` recreate an empty copy in public,
 * and a push whose schemaFilter includes the app schema would reconcile the
 * app's table to Main's declaration.
 */
export function checkExtractedSchema(manifest, source, drizzleConfig) {
  const errors = [];
  if (manifest.version !== 2 || !Array.isArray(manifest.modules)) return ['Expected generated ownership manifest version 2'];
  for (const id of ['health', 'drive']) {
    if (manifest.modules.filter((m) => m.id === id).length !== 1) errors.push(`Expected one ownership entry for ${id}`);
  }
  // Matches the repository's exported pgTable declarations, including multiline calls.
  const tables = new Set([...stripBlockComments(source)
    .matchAll(/^export\s+const\s+\w+\s*=\s*pgTable\(\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]));
  if (!tables.size) errors.push('No Main table declarations found');
  const owned = new Map();
  for (const module of manifest.modules) {
    for (const table of module.ownedTables ?? []) owned.set(table, { id: module.id, schema: module.ownedSchema });
  }
  for (const module of manifest.modules.filter((m) => m.id !== 'main')) {
    if (module.database === 'none') {
      if (!Array.isArray(module.requiredTables) || module.requiredTables.length) {
        errors.push(`${module.id}: database-free application declares tables`);
      }
      continue;
    }
    if (!Array.isArray(module.requiredTables) || !module.requiredTables.length) {
      errors.push(`${module.id}: required table set is empty`);
      continue;
    }
    for (const table of module.requiredTables) {
      if (typeof table !== 'string' || !tables.has(table)) errors.push(`${module.id}: Main must retain table ${table}`);
      if (owned.has(table)) errors.push(`${module.id}: requires ${table}, which ${owned.get(table).id} owns in its own schema`);
    }
  }
  if (owned.size) {
    for (const [table, owner] of owned) {
      if (!owner.schema || owner.schema === 'public') errors.push(`${owner.id}: owned table ${table} needs an application schema`);
      if (tables.has(table)) errors.push(`main: declares ${owner.id}-owned table ${table} in public; push would recreate it there`);
    }
    for (const { schema, table } of schemaTables(source)) {
      const owner = owned.get(table);
      if (owner && owner.schema !== schema) errors.push(`main: declares ${table} in ${schema}, but ${owner.id} owns it in ${owner.schema}`);
    }
    if (drizzleConfig !== undefined) {
      const pushed = pushedSchemas(drizzleConfig);
      if (!pushed) errors.push('drizzle.config.ts: schemaFilter must be explicit while applications own schemas');
      for (const schema of new Set([...owned.values()].map((o) => o.schema))) {
        if (pushed?.includes(schema)) errors.push(`drizzle.config.ts: schemaFilter hands application schema ${schema} to Main's push`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(process.argv[2] ?? '.');
    const manifest = JSON.parse(readFileSync(resolve(root, 'docs/module-ownership.json'), 'utf8'));
    const source = readFileSync(resolve(root, 'src/lib/db/schema.ts'), 'utf8');
    const configPath = resolve(root, 'drizzle.config.ts');
    const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined;
    const errors = checkExtractedSchema(manifest, source, config);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Extracted-app table retention: passed for registered applications.');
  } catch (error) {
    console.error(`Extracted-app table retention failed:\n${error.message}`);
    process.exitCode = 1;
  }
}
