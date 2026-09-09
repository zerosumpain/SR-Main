import { expect, it } from 'vitest';
import { prepareIllustrative } from '$lib/policy-incentives-lab/auto-resolve';
import { syntheticCandidate, syntheticSource } from '$lib/policy-incentives-lab/synthetic';
import { reviewItems, validateModel } from '$lib/policy-incentives-lab/validation';
import { runSimulation } from '$lib/policy-incentives-lab/server/engine';
const options = { seed: 73, low: -3, high: 10 };
it('reproducibly fills structural and numeric gaps without approving or mutating the original', () => {
  const input = syntheticCandidate(); input.game.assumptions.find(a => a.type === 'numerical')!.value_or_range = null;
  input.game.payoff_table.pop(); input.game.decision_rules = []; input.game.payoff_components = []; input.game.actors[0].objectives = [];
  const before = JSON.stringify(input); const result = prepareIllustrative(input, syntheticSource, options);
  expect(JSON.stringify(input)).toBe(before); expect(result).toEqual(prepareIllustrative(input, syntheticSource, options)); expect(result.errors).toEqual([]);
  expect(reviewItems(result.candidate.game).every(i => i.approval_status.status === 'pending')).toBe(true);
  expect(() => runSimulation(result.candidate.game, result.candidate.evidence, syntheticSource, result.config)).toThrow('Approval required');
  for (const a of result.candidate.game.assumptions.filter(a => a.source.includes('seeded uniform'))) { expect(a.confidence).toBe('illustrative'); expect(a.value_or_range).toMatchObject({ low: -3, high: 10 }); }
});
it('preserves existing numbers, changes samples with seed and refuses to fix bad evidence by pretending it is valid', () => {
  const input = syntheticCandidate(); const known = input.game.assumptions.find(a => a.type === 'numerical')!;
  const result = prepareIllustrative(input, syntheticSource, options); expect(result.candidate.game.assumptions.find(a => a.id === known.id)?.value_or_range).toEqual(known.value_or_range);
  known.value_or_range = null;
  expect(prepareIllustrative(input, syntheticSource, options).candidate).not.toEqual(prepareIllustrative(input, syntheticSource, { ...options, seed: 74 }).candidate);
  input.evidence[0].quotation = 'This quotation was never in the source.';
  expect(prepareIllustrative(input, syntheticSource, options).errors.join(' ')).toContain('quotation/location');
});
it('prepared and explicitly approved setup can run byte-identically with saved configuration', () => {
  const p = prepareIllustrative(syntheticCandidate(), syntheticSource, options);
  for (const item of reviewItems(p.candidate.game)) { item.approval_status = { status: 'approved', approved_by: 'synthetic-reviewer', approved_at: '2026-01-01T00:00:00Z' }; if ('approved_by_user' in item) item.approved_by_user = true; }
  expect(validateModel(p.candidate.game, p.candidate.evidence, syntheticSource)).toEqual([]);
  expect(JSON.stringify(runSimulation(p.candidate.game, p.candidate.evidence, syntheticSource, p.config))).toBe(JSON.stringify(runSimulation(p.candidate.game, p.candidate.evidence, syntheticSource, p.config)));
});
