import { candidateSchema, pendingApproval, type PolicySource } from './schemas';

export const SYNTHETIC_TEXT = 'SYNTHETIC EXAMPLE — fictional Lantern Borough Repair Scheme. Two fictional workshops, Amber and Blue, receive illustrative credits for repairing shared lanterns. Each can choose careful repair or rush its allocation. The intended outcome is reliable lanterns with fair access and controlled resource use. A workshop observes the other workshop’s previous choice after each round. No real organisation, person, programme or policy is represented. All payoff numbers and strategic responses are illustrative model assumptions, not claims from a published policy.';
export const syntheticSource: PolicySource = {
  id: 'synthetic-source', title: 'SYNTHETIC — Lantern Borough Repair Scheme', publisher: 'Fictional example',
  publication_date: null, source_url: '', document_hash: '', synthetic: true,
  text_sections: [{ id: 'section-1', location: 'Section 1', text: SYNTHETIC_TEXT }], input_flags: [],
};
export function syntheticCandidate() {
  const approval = pendingApproval;
  const evidence = [{ id: 'ev-scheme', source_id: 'synthetic-source', quotation: SYNTHETIC_TEXT, location: 'Section 1', explicit_or_inferred: 'explicit', confidence: 'high', extraction_method: 'deterministic synthetic fixture' }];
  const provenance = { evidence_refs: ['ev-scheme'], assumption_refs: [] as string[] };
  const assumptionRefs = { evidence_refs: [] as string[], assumption_refs: ['behaviour'] };
  const statement = (id: string, statement: string) => ({ id, statement, ...provenance, approval_status: approval() });
  const actors = ['amber', 'blue'].map(id => ({
    id, name: id === 'amber' ? 'Amber Workshop' : 'Blue Workshop', description: 'Fictional workshop; no real organisation.',
    objectives: [statement(`${id}-objective`, 'Receive illustrative repair credits')],
    constraints: [statement(`${id}-constraint`, 'Choose careful repair or rush the allocation')],
    resources: [statement(`${id}-resource`, 'An allocation of fictional lantern repairs')],
    information_available: [statement(`${id}-info`, 'The previous-round choice is observable')], information_hidden: [],
    ...provenance, approval_status: approval(),
  }));
  const strategies = actors.flatMap(a => ['careful', 'rush'].map(s => ({ id: `${a.id}-${s}`, actor_id: a.id, name: s, description: `Choose ${s} repair`, preconditions: [], expected_direct_effects: [], ...provenance, approval_status: approval() })));
  const assumptions: unknown[] = [
    { id: 'behaviour', statement: 'Illustrative decision rules and causal payoff table; neither describes actual human behaviour.', type: 'behavioural', value_or_range: null, source: 'Synthetic fixture author', confidence: 'illustrative', sensitivity_priority: 'high', approved_by_user: false, approval_status: approval() },
    { id: 'weight', statement: 'One credit has payoff weight one for the receiving workshop.', type: 'numerical', value_or_range: 1, source: 'Synthetic fixture author', confidence: 'illustrative', sensitivity_priority: 'low', approved_by_user: false, approval_status: approval() },
  ];
  const numbers = [[3, 3, 8, 2], [0, 5, 4, 4], [5, 0, 4, 4], [1, 1, 2, 6]];
  const metricIds = ['amber-credits', 'blue-credits', 'reliability', 'resource-cost'];
  const payoff_table = numbers.map((values, i) => {
    const outcome_values: Record<string, string> = {};
    values.forEach((value, j) => {
      const id = `value-${i}-${j}`; outcome_values[metricIds[j]] = id;
      assumptions.push({ id, statement: `Illustrative ${metricIds[j]} for payoff profile ${i + 1}`, type: 'numerical', value_or_range: { low: 0, central: value, high: 10 }, source: 'Synthetic fixture author — not source evidence', confidence: 'illustrative', sensitivity_priority: 'high', approved_by_user: false, approval_status: approval() });
    });
    return { id: `row-${i}`, profile: { amber: `amber-${i < 2 ? 'careful' : 'rush'}`, blue: `blue-${i % 2 === 0 ? 'careful' : 'rush'}` }, outcome_values, ...assumptionRefs, approval_status: approval() };
  });
  return candidateSchema.parse({ evidence, game: {
    version: 1, approval_status: approval(), actors, strategies, assumptions, payoff_table,
    objectives: [statement('objective', 'Explore reliable lantern repair')], operative_mechanisms: [statement('mechanism', 'Credits reward workshop choices')],
    outcome_metrics: metricIds.map(id => ({ id, name: id.replaceAll('-', ' '), description: 'Illustrative scenario metric', unit: id.includes('credits') ? 'fictional credits' : 'illustrative units', desired_direction: id === 'resource-cost' ? 'decrease' : 'increase', policy_priority: id === 'reliability' ? 'primary' : 'secondary', measurement_limitations: 'Arbitrary toy scale; no real fiscal, distributional or operational estimate.', ...assumptionRefs, approval_status: approval() })),
    payoff_components: actors.map(a => ({ id: `${a.id}-payoff`, actor_id: a.id, outcome_metric_id: `${a.id}-credits`, weight_or_range: 'weight', rationale: 'Illustrative self-interested credit preference', provenance: 'Synthetic fixture author', ...assumptionRefs, approval_status: approval() })),
    interactions: [{ id: 'interaction', actor_ids: ['amber', 'blue'], sequence: 0, information_structure: 'observable', repeat_frequency: 'Once per configured round', dependency: 'For sequential mode Amber moves first and Blue observes; for repeated mode both observe the previous round.', ...assumptionRefs, approval_status: approval() }],
    intended_outcomes: [statement('intended', 'Reliable lanterns with fair access and controlled resource use')],
    causal_relationships: [{ id: 'causal', statement: 'The illustrative payoff table assumes rushing reduces reliability and raises resource cost.', ...assumptionRefs, approval_status: approval() }],
    decision_rules: actors.map(a => ({ id: `${a.id}-rule`, actor_id: a.id, rule: 'maximise', threshold_assumption: null, schedule: [], ...assumptionRefs, approval_status: approval() })),
    model_limitations: ['SYNTHETIC example. No real policy, organisation or population is modelled.', 'Finite strategy choices and fixed payoffs omit learning, institutions, heterogeneous needs and real behavioural evidence.', 'Optimistic and adverse labels do not automatically select parameter directions; the user must configure approved values.'],
  } });
}
