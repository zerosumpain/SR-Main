import type { Artefact } from './contracts';
export const MODEL_LIBRARY = [
  { pattern: 'principal_agent', trigger: ['commissions', 'is_accountable_for'], mechanism: 'A principal delegates to an agent whose effort or objectives may differ. Compare monitoring, discretion, rewards and sanctions; ask whether the agent can satisfy the measure while defeating the objective.' },
  { pattern: 'collective_action', trigger: ['depends_on', 'receives_benefit_from'], mechanism: 'Each player can contribute or free-ride on shared benefits. Compare private contribution costs, exclusion, reciprocal benefits and credible commitments.' },
  { pattern: 'coordination', trigger: ['depends_on', 'reports_to'], mechanism: 'Players benefit from compatible choices, but uncertain timing or standards can sustain an inferior stable pattern. Examine focal points, dependency order and assurance.' },
  { pattern: 'metric_gaming', trigger: ['is_measured_by', 'owns_data'], mechanism: 'Measured performance can diverge from the intended outcome. Compare genuine effort, selection, relabelling and reporting manipulation, including detection and audit.' },
  { pattern: 'information_asymmetry', trigger: ['supplies_data_to', 'owns_data'], mechanism: 'One actor controls decision-relevant information. Examine withholding, selective disclosure, verification costs and incentives to share.' },
  { pattern: 'enforcement_credibility', trigger: ['regulates', 'sanctions'], mechanism: 'Compliance depends on expected detection and credible lawful sanctions. Test whether the enforcer would actually carry out the threatened response after non-compliance.' },
  { pattern: 'bargaining_veto', trigger: ['can_veto', 'has_authority_over'], mechanism: 'Outcomes depend on actors whose consent or resources are indispensable. Compare outside options, bargaining power, compensation and holdout incentives.' },
  { pattern: 'repeated_interaction', trigger: ['reports_to', 'reciprocates'], mechanism: 'Future cooperation can support reciprocity when defection is observable and relationships endure. Examine leadership turnover, delayed signals and forgiveness or escalation rules.' },
] as const;
export function modelApplicability(artefacts: Artefact[]) {
  return MODEL_LIBRARY.map((pattern) => ({ ...pattern, triggerEvidence: artefacts.filter((a) => a.kind === 'edge' && pattern.trigger.some((r) => r === a.relation)).map((a) => a.id) }));
}
