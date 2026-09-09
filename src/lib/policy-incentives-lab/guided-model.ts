import { z } from 'zod';
import { candidateSchema, pendingApproval, type Candidate } from './schemas';
const words = z.string().trim().min(1).max(1000);
export const guidedModelSchema = z.object({ intended: words, mechanism: words, metric: words, unit: words,
  people: z.array(z.object({ name: words, wants: words, first: words, second: words }).strict()).length(2),
}).strict();
/** A novice's qualitative outline. No evidence or numerical values are invented. */
export function guidedModel(input: unknown, reviewer: string): Candidate {
  const v = guidedModelSchema.parse(input);
  const review = (id: string) => ({ id, approval_status: pendingApproval() });
  const provenance = { evidence_refs: [], assumption_refs: ['reviewer-outline'] };
  const statement = (id: string, text: string) => ({ ...review(id), statement: text, ...provenance });
  const assumption = (id: string, text: string) => ({ ...review(id), statement: text, type: 'numerical', value_or_range: null, source: `Not supplied; requested from ${reviewer}`, confidence: 'unknown', approved_by_user: false, sensitivity_priority: 'high' });
  const actors = v.people.map((p, i) => ({ ...review(`person-${i}`), name: p.name, description: 'Reviewer-proposed group; check against the policy and first look.', objectives: [statement(`wants-${i}`, p.wants)], constraints: [], resources: [], information_available: [], information_hidden: [], ...provenance }));
  const strategies = v.people.flatMap((p, i) => [p.first, p.second].map((name, j) => ({ ...review(`choice-${i}-${j}`), actor_id: `person-${i}`, name, description: name, preconditions: [], expected_direct_effects: [], ...provenance })));
  const rows = [0, 1].flatMap(a => [0, 1].map(b => ({ ...review(`combination-${a}-${b}`), profile: { 'person-0': `choice-0-${a}`, 'person-1': `choice-1-${b}` }, outcome_values: { outcome: `outcome-${a}-${b}` }, ...provenance })));
  return candidateSchema.parse({ evidence: [], game: { version: 1, approval_status: pendingApproval(),
    objectives: [statement('objective', v.intended)], operative_mechanisms: [statement('mechanism', v.mechanism)], intended_outcomes: [statement('intended', v.intended)],
    actors, strategies, outcome_metrics: [{ ...review('outcome'), name: v.metric, description: v.metric, unit: v.unit, desired_direction: 'increase', policy_priority: 'primary', measurement_limitations: 'Reviewer must check what this measure misses and whether more or less is desirable.', ...provenance }],
    assumptions: [{ ...review('reviewer-outline'), statement: `Reviewer outline: ${JSON.stringify(v)}. This starter simplifies the policy to two groups and two choices, and initially asks each artificial group to choose its highest calculated value. These are unapproved modelling assumptions, not source evidence.`, type: 'structural', value_or_range: null, source: `Entered by ${reviewer}`, confidence: 'user-supplied', approved_by_user: false, sensitivity_priority: 'high' }, ...v.people.map((p, i) => assumption(`importance-${i}`, `How much does ${v.metric} matter to ${p.name}? Negative means a cost to them.`)), ...[0, 1].flatMap(a => [0, 1].map(b => assumption(`outcome-${a}-${b}`, `${v.metric} when ${v.people[0].name} chooses ${v.people[0][a ? 'second' : 'first']} and ${v.people[1].name} chooses ${v.people[1][b ? 'second' : 'first']}.`)))],
    payoff_components: v.people.map((p, i) => ({ ...review(`importance-link-${i}`), actor_id: `person-${i}`, outcome_metric_id: 'outcome', weight_or_range: `importance-${i}`, rationale: 'Importance is unknown; the reviewer must supply and explain it.', provenance: 'Reviewer outline; not policy evidence', ...provenance })),
    decision_rules: v.people.map((_, i) => ({ ...review(`decision-${i}`), actor_id: `person-${i}`, rule: 'maximise', threshold_assumption: null, schedule: [], ...provenance })),
    payoff_table: rows, interactions: [], causal_relationships: [], model_limitations: ['A small reviewer-authored outline, not an extracted account of the policy. Constraints, resources, information, additional groups and causal links still require review. All numerical values are unknown.'],
  } });
}
