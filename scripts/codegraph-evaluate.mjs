#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateRetrieval, compareBuildOutcomes } from './lib/codegraph-evaluation.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/codegraph-evaluate.mjs <reviewed-results.json> <report.json>');
const data = JSON.parse(readFileSync(input, 'utf8'));
const retrieval = (data.retrieval ?? []).map(row => {
  if (!row.snapshotRevision || !row.availableAt || !row.taskAt || !Number.isFinite(Date.parse(row.availableAt)) || !Number.isFinite(Date.parse(row.taskAt)) || Date.parse(row.availableAt) > Date.parse(row.taskAt)) throw new Error('Each case requires pre-task snapshot provenance');
  return { id: row.id, policy: row.policy, snapshotRevision: row.snapshotRevision, ...evaluateRetrieval(row) };
});
writeFileSync(output, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), retrieval,
  buildGroups: compareBuildOutcomes(data.builds ?? []), interpretation: 'Compare matched task/model/budget groups. Observational outcomes do not establish causality; missing metrics remain absent.' }, null, 2) + '\n');
console.log(`Evaluated ${retrieval.length} retrieval cases and ${(data.builds ?? []).length} build observations: ${output}`);
