import { describe, expect, it } from 'vitest';
import { syntheticCandidate, syntheticSource } from '$lib/policy-incentives-lab/synthetic';
import { reviewItems, resetApprovals, validateModel } from '$lib/policy-incentives-lab/validation';
import { candidateSchema, runConfigSchema, type RunConfig } from '$lib/policy-incentives-lab/schemas';
import { canonical, runSimulation, sensitivity } from '$lib/policy-incentives-lab/server/engine';

export function approved() {
  const candidate = syntheticCandidate();
  for (const item of reviewItems(candidate.game)) {
    item.approval_status = { status: 'approved', approved_by: 'synthetic-reviewer', approved_at: '2026-01-01T00:00:00.000Z' };
    if ('approved_by_user' in item) item.approved_by_user = true;
  }
  return candidate;
}
const config: RunConfig = { simulation_type: 'normal-form', seed: 42, rounds: 20, scenario: 'baseline', parameters: {} };
const run = (candidate = approved(), options = config) => runSimulation(candidate.game, candidate.evidence, syntheticSource, options);

describe('Policy Incentives Lab engine', () => {
  it('validates the synthetic schema and exact source quotations', () => {
    const c = approved(); expect(candidateSchema.safeParse(c).success).toBe(true);
    expect(validateModel(c.game, c.evidence, syntheticSource)).toEqual([]);
    c.evidence[0].quotation = 'Not in the source';
    expect(validateModel(c.game, c.evidence, syntheticSource).join()).toContain('quotation/location');
  });
  it('finds the prisoner-dilemma equilibrium and exposes payoff calculation terms', () => {
    const result = run(); expect(result.equilibria).toHaveLength(1);
    expect(result.equilibria[0].profile).toEqual({ amber: 'amber-rush', blue: 'blue-rush' });
    expect(result.equilibria[0].payoffs).toEqual({ amber: 1, blue: 1 });
    expect(result.equilibria[0].terms[0]).toMatchObject({ value: 1, weight: 1, product: 1 });
  });
  it('reports no pure equilibrium in matching pennies', () => {
    const c = approved();
    for (let row = 0; row < 4; row++) {
      c.game.assumptions.find(a => a.id === `value-${row}-0`)!.value_or_range = row === 0 || row === 3 ? 1 : -1;
      c.game.assumptions.find(a => a.id === `value-${row}-1`)!.value_or_range = row === 0 || row === 3 ? -1 : 1;
    }
    expect(run(c).equilibria).toEqual([]); expect(run(c).notices.join()).toContain('No pure-strategy');
  });
  it('reports every pure equilibrium when payoffs tie', () => {
    const c = approved(); c.game.assumptions.find(a => a.id === 'weight')!.value_or_range = 0;
    expect(run(c).equilibria).toHaveLength(4);
  });
  it('performs backward induction only for complete observable orders', () => {
    const c = approved(); const input = { ...config, simulation_type: 'sequential' as const };
    expect(run(c, input).terminal_outcomes[0].profile).toEqual({ amber: 'amber-rush', blue: 'blue-rush' });
    c.game.interactions[0].information_structure = 'hidden';
    expect(run(c, input).terminal_outcomes).toEqual([]); expect(run(c, input).notices.join()).toContain('not supported');
  });
  it.each(['repeated', 'agent-based'] as const)('produces byte-identical %s output including all rounds', type => {
    const c = approved(); const input = { ...config, simulation_type: type };
    const first = canonical(run(c, input)); const second = canonical(run(structuredClone(c), structuredClone(input)));
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true); expect(run(c, input).rounds).toHaveLength(20);
  });
  it.each(['maximise', 'satisfice', 'risk-averse', 'imitate', 'rule-based'] as const)('executes the structured %s decision rule', rule => {
    const c = approved();
    for (const r of c.game.decision_rules) { r.rule = rule; r.threshold_assumption = 'weight'; r.schedule = [{ through_round: 20, strategy_id: `${r.actor_id}-careful` }]; }
    const result = run(c, { ...config, simulation_type: 'agent-based' });
    expect(result.rounds).toHaveLength(20);
    if (rule === 'rule-based') expect(result.rounds[19].profile.amber).toBe('amber-careful');
  });
  it('blocks all unapproved assumptions and nested objectives', () => {
    const c = approved(); c.game.assumptions[0].approved_by_user = false;
    expect(() => run(c)).toThrow('Assumption not approved');
    const other = approved(); other.game.actors[0].objectives[0].approval_status.status = 'pending';
    expect(() => run(other)).toThrow('Approval required');
    expect(() => run({ ...other, game: resetApprovals(other.game) })).toThrow('Approval required');
  });
  it('rejects unknown payoff values, references, actors and incomplete tables', () => {
    const c = approved(); c.game.assumptions[1].value_or_range = null;
    expect(() => run(c)).toThrow('Unknown numerical value');
    const c2 = approved(); c2.game.actors[0].evidence_refs = ['missing']; expect(() => run(c2)).toThrow('Unknown evidence');
    const c3 = approved(); c3.game.strategies[0].actor_id = 'missing'; expect(() => run(c3)).toThrow('Unknown actor');
    const c4 = approved(); c4.game.payoff_table.pop(); expect(() => run(c4)).toThrow('Missing payoff profile');
  });
  it('permits overrides only within explicitly approved ranges', () => {
    expect(() => run(approved(), { ...config, parameters: { 'value-3-0': 11 } })).toThrow('outside approved');
    expect(() => run(approved(), { ...config, parameters: { weight: 2 } })).toThrow('outside approved');
    expect(() => run(approved(), { ...config, parameters: { unknown: 2 } })).toThrow('Unknown parameter');
    expect(runConfigSchema.safeParse({ ...config, seed: Infinity }).success).toBe(false);
  });
  it('generates deterministic inclusive sensitivity values and reports outcome ranges', () => {
    const c = approved(); const request = { config, ranges: [{ assumption_id: 'value-3-0', low: 0, high: 10, steps: 3 }] };
    const result = sensitivity(c.game, c.evidence, syntheticSource, request);
    expect(result.samples[0].points.map(p => p.value)).toEqual([0, 5, 10]);
    expect(result.samples[0].outcome_ranges['amber-credits']).toEqual({ low: 0, high: 10 });
    expect(canonical(result)).toBe(canonical(sensitivity(c.game, c.evidence, syntheticSource, request)));
  });
});
