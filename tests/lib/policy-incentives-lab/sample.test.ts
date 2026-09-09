import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { syntheticCandidate, syntheticSource } from '$lib/policy-incentives-lab/synthetic';
import { reviewItems } from '$lib/policy-incentives-lab/validation';
import { canonical, ENGINE_VERSION, runSimulation } from '$lib/policy-incentives-lab/server/engine';
import { reportMarkdown } from '$lib/policy-incentives-lab/server/report';
import type { Draft } from '$lib/policy-incentives-lab/server/store';

it('keeps the shipped synthetic fixture and sample report reproducible', () => {
  const candidate = syntheticCandidate();
  const source = { ...syntheticSource, document_hash: createHash('sha256').update(syntheticSource.text_sections[0].text).digest('hex') };
  const fixture = JSON.stringify({ source, candidate }, null, 2) + '\n';
  for (const item of reviewItems(candidate.game)) {
    item.approval_status = { status: 'approved', approved_by: 'synthetic-reviewer', approved_at: '2026-01-01T00:00:00.000Z' };
    if ('approved_by_user' in item) item.approved_by_user = true;
  }
  candidate.game.approval_status = { status: 'approved', approved_by: 'synthetic-reviewer', approved_at: '2026-01-01T00:00:00.000Z' };
  const config = { simulation_type: 'normal-form' as const, seed: 42, rounds: 1, scenario: 'baseline' as const, parameters: {} };
  const result = runSimulation(candidate.game, candidate.evidence, source, config);
  const snapshot: Draft = { source, candidate, attempts: [], activity: [{ at: '2026-01-01T00:00:00.000Z', action: 'Synthetic fixture review; not a real person’s approval', item_ids: reviewItems(candidate.game).map(i => i.id) }], hypotheses: [] };
  const record = { synthetic: true, policy_version: source.document_hash, approved_model_version: 1, engine_version: ENGINE_VERSION, timestamp: '2026-01-01T00:00:00.000Z', config, result, result_hash: createHash('sha256').update(canonical(result)).digest('hex') };
  const markdown = reportMarkdown('SYNTHETIC Lantern example', snapshot, record);
  const files = {
    'tests/fixtures/policy-incentives-lab/lantern.json': fixture,
    'docs/policy-incentives-lab/sample-analysis.md': markdown,
    'docs/policy-incentives-lab/sample-analysis.json': JSON.stringify({ snapshot, run: record }, null, 2) + '\n',
  };
  if (process.env.POLICY_LAB_REGENERATE_SAMPLE === '1') for (const [path, content] of Object.entries(files)) writeFileSync(path, content);
  for (const [path, content] of Object.entries(files)) expect(readFileSync(path, 'utf8')).toBe(content);
});
