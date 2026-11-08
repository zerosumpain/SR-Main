import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkExtractedSchema } from './check-extracted-schema.mjs';

const manifest = () => ({ version: 2, modules: ['health', 'drive'].map((id) => ({ id, requiredTables: ['shared'] })) });
const schema = 'export const renamedSymbol = pgTable(\n "shared", {});\n';

test('allows shared ownership and symbol renames while preserving physical tables', () => {
  assert.deepEqual(checkExtractedSchema(manifest(), schema), []);
});

test('a commented-out table does not preserve any consumer', () => {
  const errors = checkExtractedSchema(manifest(), `/*\n${schema}*/\n// ${schema.trim()}\n`);
  for (const id of ['health', 'drive']) assert.ok(errors.includes(`${id}: Main must retain table shared`));
});

test('omitting an app or its required tables fails closed', () => {
  const data = manifest();
  data.modules.pop();
  data.modules[0].requiredTables = [];
  const errors = checkExtractedSchema(data, schema).join('\n');
  assert.match(errors, /one ownership entry for drive/);
  assert.match(errors, /health: required table set is empty/);
  assert.match(checkExtractedSchema({ version: 1, modules: [] }, schema).join('\n'), /version 2/);
});

test('database-free extracted applications require an explicit empty table set', () => {
  const data = manifest();
  data.modules.push({ id: 'local-plan-navigator', database: 'none', requiredTables: [] });
  assert.deepEqual(checkExtractedSchema(data, schema), []);
  data.modules.at(-1).requiredTables = ['shared'];
  assert.ok(checkExtractedSchema(data, schema).includes('local-plan-navigator: database-free application declares tables'));
});

test('an application that owns its schema may require nothing else from Main', () => {
  const data = manifest();
  const owned = `${schema}export const policySchema = pgSchema('policy');\nexport const snapshots = policySchema.table(\n  'snapshots', {});\n`;
  const config = "export default { schemaFilter: ['public'], tablesFilter: ['!snapshots'] };\n";
  data.modules.push({ id: 'policy-engine', requiredTables: [], ownedSchema: 'policy', ownedTables: ['snapshots'] });
  assert.deepEqual(checkExtractedSchema(data, owned, config), []);
  delete data.modules.at(-1).ownedTables;
  assert.ok(checkExtractedSchema(data, owned, config).includes('policy-engine: required table set is empty'));
});

test('app-owned tables must stay out of public and out of Main\'s push', () => {
  const data = manifest();
  data.modules.push({ id: 'policy-engine', requiredTables: ['shared'], ownedSchema: 'policy', ownedTables: ['snapshots'] });
  const owned = `${schema}export const policySchema = pgSchema('policy');\nexport const snapshots = policySchema.table(\n  'snapshots', {});\n`;
  const config = "export default { schemaFilter: ['public'], tablesFilter: ['!snapshots'] };\n";
  assert.deepEqual(checkExtractedSchema(data, owned, config), []);
  // Removing Main's declaration entirely is also fine: push cannot see the schema.
  assert.deepEqual(checkExtractedSchema(data, schema, config), []);
  assert.match(checkExtractedSchema(data, `${schema}export const snapshots = pgTable('snapshots', {});\n`, config).join('\n'),
    /main: declares policy-engine-owned table snapshots in public/);
  assert.match(checkExtractedSchema(data, owned.replace("pgSchema('policy')", "pgSchema('dsd')"), config).join('\n'),
    /declares snapshots in dsd, but policy-engine owns it in policy/);
  assert.match(checkExtractedSchema(data, owned, "export default { schemaFilter: ['public', 'policy'] };").join('\n'),
    /schemaFilter hands application schema policy to Main's push/);
  assert.match(checkExtractedSchema(data, owned, "export default { /* schemaFilter: ['public'] */ };").join('\n'),
    /schemaFilter must be explicit/);
  data.modules[0].requiredTables.push('snapshots');
  assert.match(checkExtractedSchema(data, owned, config).join('\n'), /health: requires snapshots, which policy-engine owns/);
});

test('CLI exits unsuccessfully before a release can proceed with a removed table', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sr-table-retention-'));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'src/lib/db'), { recursive: true });
  writeFileSync(join(root, 'docs/module-ownership.json'), JSON.stringify(manifest()));
  writeFileSync(join(root, 'src/lib/db/schema.ts'), "export const other = pgTable('other', {});\n");
  const result = spawnSync(process.execPath, [new URL('./check-extracted-schema.mjs', import.meta.url).pathname, root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Main must retain table shared/);
});

test('release checks retention before any production preparation', () => {
  const script = readFileSync(new URL('./ci-release.sh', import.meta.url), 'utf8');
  const guard = script.indexOf('node scripts/check-extracted-schema.mjs');
  assert.ok(guard > script.indexOf('set -euo pipefail'));
  assert.ok(guard < script.indexOf('VPS_DIR='));
});
