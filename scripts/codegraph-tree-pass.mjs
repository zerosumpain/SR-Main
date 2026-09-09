#!/usr/bin/env node
/** Publish an atomic structural snapshot from the exact named commit. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scipRelationships } from './lib/codegraph-scip.mjs';
import { snapshotTree } from './lib/codegraph-snapshot.mjs';
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const snapshot = snapshotTree(flag('root', process.cwd()), flag('ref', 'HEAD'), flag('repo', 'SR-Main'));
const scipFile = flag('scip', null);
if (scipFile) { if (flag('scip-ref', null) !== snapshot.revision) throw new Error('--scip-ref must name the full indexed commit SHA'); const semantic = scipRelationships(JSON.parse(readFileSync(scipFile, 'utf8')), snapshot.files); snapshot.edges.push(...semantic.edges); snapshot.semantic = { revision: snapshot.revision, indexHash: createHash('sha256').update(readFileSync(scipFile)).digest('hex'), provider: semantic.provider, symbols: semantic.symbols, unresolved: semantic.unresolved }; }
if (args.includes('--dry')) console.log(JSON.stringify({ revision: snapshot.revision, files: snapshot.files.length, edges: snapshot.edges.length, unresolved: snapshot.unresolved.length, dependencies: snapshot.dependencies.length }));
else {
  const token = process.env.CODEGRAPH_TOKEN || process.env.CLAUDE_CHANGELOG_SECRET;
  if (!token) throw new Error('CODEGRAPH_TOKEN is required');
  const response = await fetch(flag('url', process.env.CODEGRAPH_URL || 'http://127.0.0.1:4173/api/jkai/codegraph/ingest'), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ snapshot, scope: flag('scope', 'deployed') }), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Snapshot ingest failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  console.log(JSON.stringify(await response.json()));
}
