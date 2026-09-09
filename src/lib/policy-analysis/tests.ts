import { artefact, type Artefact } from './contracts';

export const POLICY_TESTS = [
  ['authority', 'Responsibility–authority alignment', 'is_accountable_for', 'has_authority_over', 'Give responsible actors explicit decision rights.'],
  ['resources', 'Accountability–resource alignment', 'is_accountable_for', 'funds', 'Identify and commit resources to accountable actors.'],
  ['distribution', 'Cost–benefit alignment', 'bears_cost_of', 'receives_benefit_from', 'Compensate actors bearing costs and examine distributional effects.'],
  ['cooperation', 'Cooperation and free-riding', 'depends_on', 'reciprocates', 'Specify reciprocal commitments and shared benefits.'],
  ['observability', 'Observability of effort and outcomes', 'is_accountable_for', 'is_measured_by', 'Make effort and outcomes observable with independent checks.'],
  ['metrics', 'Metric integrity and gaming', 'is_measured_by', 'owns_data', 'Assign data ownership and audit measures for gaming.'],
  ['enforcement', 'Enforcement credibility', 'regulates', 'sanctions', 'Specify lawful, feasible sanctions and credible enforcement.'],
  ['coordination', 'Coordination dependency', 'depends_on', 'is_accountable_for', 'Name dependency owners, reporting routes and fallbacks.'],
  ['information', 'Information asymmetry', 'supplies_data_to', 'reciprocates', 'Provide incentives, standards and accountability for timely sharing.'],
  ['veto', 'Veto and bottleneck exposure', 'can_veto', 'is_accountable_for', 'Make veto rights transparent and provide escalation and accountability.'],
  ['power', 'Distributional and power effects', 'has_authority_over', 'bears_cost_of', 'Review whose interests control decisions and who bears their costs.'],
  ['adaptability', 'Adaptability under changing conditions', 'delivers', 'can_adapt', 'Add review points, feedback and authority to adapt.'],
] as const;

export function runPolicyTests(all: Artefact[]): Artefact[] {
  const edges = all.filter((a) => a.kind === 'edge');
  const assumptions = all.filter((a) => a.kind === 'assumption');
  const models = all.filter((a) => a.kind === 'model');
  const patterns: Record<string, string> = { authority: 'principal_agent', resources: 'principal_agent', distribution: 'collective_action', cooperation: 'collective_action', observability: 'principal_agent', metrics: 'metric_gaming', enforcement: 'enforcement_credibility', coordination: 'coordination', information: 'information_asymmetry', veto: 'bargaining_veto', power: 'bargaining_veto', adaptability: 'repeated_interaction' };
  return POLICY_TESTS.map(([testId, name, trigger, counterpart, mitigation]) => {
    const relevant = edges.filter((e) => e.relation === trigger || (testId === 'information' && e.relation === 'owns_data') || (testId === 'coordination' && e.relation === 'reports_to'));
    const missing = relevant.filter((e) => !edges.some((other) => {
      if (other.relation !== counterpart) return false;
      if (testId === 'resources') return other.toId === e.fromId;
      if (testId === 'metrics') return other.toId === e.toId;
      if (testId === 'coordination') return other.toId === e.toId;
      if (testId === 'information' && e.relation === 'owns_data') return other.toId === e.fromId;
      if (testId === 'cooperation' || testId === 'information') return other.fromId === e.toId && other.toId === e.fromId;
      if (testId === 'observability' || testId === 'enforcement' || testId === 'adaptability') return other.fromId === e.fromId;
      return other.fromId === e.fromId && other.toId === e.toId;
    }));
    // 'high_risk' used to be unreachable: every shortfall, however total, read as
    // moderate. A check where EVERY relevant assertion lacks its counterpart, over
    // more than one assertion, is a different finding from one where some do.
    const result = !relevant.length ? 'indeterminate'
      : !missing.length ? 'low_risk'
      : missing.length === relevant.length && relevant.length >= 2 ? 'high_risk'
      : 'moderate_risk';
    const inputs = [...new Set([...relevant.map((e) => e.id), ...edges.filter((e) => e.relation === counterpart).map((e) => e.id)])];
    const related = new Set(relevant.flatMap((e) => [e.fromId, e.toId]));
    const relevantModels = models.filter((m) => m.data.pattern === patterns[testId]);
    const relevantAssumptions = assumptions.filter((a) => a.refs.some((id) => related.has(id)) || relevantModels.some((m) => (m.data.assumptions as string[]).includes(a.id)));
    const refs = [...new Set([...inputs, ...relevantAssumptions.map((a) => a.id), ...relevantModels.map((a) => a.id)])];
    const label = (id: string | null) => all.find((a) => a.id === id)?.label ?? null;
    const named = [...new Set(missing.map((e) => label(e.fromId)).filter((n): n is string => !!n))].slice(0, 6);
    const extra = testId === 'coordination'
      ? ` ${conflictingReportingLines(edges).length} actor(s) have multiple reporting targets; whether these conflict needs institutional interpretation.` : '';
    const reasoning = !relevant.length
      ? 'No applicable graph assertion was extracted. Evidence is insufficient; this is not a pass.'
      : missing.length
        ? `${missing.length} of ${relevant.length} relevant assertions have no documented matching ${counterpart} relationship. This is a structural review signal: missing evidence does not prove missing powers, resources or incentives.`
        : `All ${relevant.length} extracted relationships have a corresponding ${counterpart} relationship. This only establishes structural coverage; adequacy and behaviour remain uncertain.`;
    return artefact(`test_${testId}`, 'test', name, reasoning + extra, {
      testId, rationale: `Check ${trigger} against ${counterpart} in the provenance graph.`, inputs,
      rule: `${trigger} requires a corresponding ${counterpart}; absent trigger = indeterminate; missing counterpart = moderate review risk; matched = low structural risk.`,
      reasoning: reasoning + extra, result, severity: result === 'indeterminate' ? 'unknown' : result === 'high_risk' ? 'high' : result === 'moderate_risk' ? 'moderate' : 'low',
      actors: [...new Set(relevant.map((e) => e.fromId).filter((id): id is string => !!id))],
      mitigation: named.length ? `${mitigation} Here that means: ${named.join(', ')}.` : mitigation,
    }, { origin: 'structural_inference', confidence: relevant.length ? Math.min(0.6, ...relevant.map((e) => e.confidence ?? 0)) : null, refs });
  });
}
export function conflictingReportingLines(edges: Artefact[]): string[] {
  const reporting = new Map<string, Set<string>>();
  for (const edge of edges) if (edge.relation === 'reports_to' && edge.fromId && edge.toId) {
    const targets = reporting.get(edge.fromId) ?? new Set<string>(); targets.add(edge.toId); reporting.set(edge.fromId, targets);
  }
  return [...reporting].filter(([, targets]) => targets.size > 1).map(([id]) => id);
}
