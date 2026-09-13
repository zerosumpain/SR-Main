#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Minimum table-retention check; column compatibility still needs migration review. */
export function checkExtractedSchema(manifest, source) {
  const errors = [];
  if (manifest.version !== 2 || !Array.isArray(manifest.modules)) return ['Expected generated ownership manifest version 2'];
  for (const id of ['policy-analysis', 'health', 'drive']) {
    if (manifest.modules.filter((m) => m.id === id).length !== 1) errors.push(`Expected one ownership entry for ${id}`);
  }
  // Matches the repository's exported pgTable declarations, including multiline calls.
  const tables = new Set([...source.replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/^export\s+const\s+\w+\s*=\s*pgTable\(\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]));
  if (!tables.size) errors.push('No Main table declarations found');
  for (const module of manifest.modules.filter((m) => m.id !== 'main')) {
    if (!Array.isArray(module.requiredTables) || !module.requiredTables.length) {
      errors.push(`${module.id}: required table set is empty`);
      continue;
    }
    for (const table of module.requiredTables) {
      if (typeof table !== 'string' || !tables.has(table)) errors.push(`${module.id}: Main must retain table ${table}`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(process.argv[2] ?? '.');
    const manifest = JSON.parse(readFileSync(resolve(root, 'docs/module-ownership.json'), 'utf8'));
    const source = readFileSync(resolve(root, 'src/lib/db/schema.ts'), 'utf8');
    const errors = checkExtractedSchema(manifest, source);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Extracted-app table retention: passed (Policy, Health, Drive).');
  } catch (error) {
    console.error(`Extracted-app table retention failed:\n${error.message}`);
    process.exitCode = 1;
  }
}
