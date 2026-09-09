// Synthetic provider responses used only by automated tests. Not a runtime fallback.
import { artefact, PATTERNS, SCENARIOS, PROFILE_FIELDS, type Artefact, type StageInput, type StageOutput } from '../../../src/lib/policy-analysis/contracts';
export function fixtureModel(stage: number, _key: string, raw: unknown): StageOutput {
  const input = raw as StageInput & { idPrefix: string; targetActorId?: string; targetPattern?: string; targetScenario?: string };
  const prefix = input.idPrefix;
  const one = (kind: Artefact['kind']) => input.artefacts.find((a) => a.kind === kind && (kind !== 'actor' || stage < 3 || a.id.startsWith('s2_')))!;
  const make = (id: string, kind: Artefact['kind'], data: Record<string, unknown>, refs: string[], statement = 'Synthetic fixture assessment; not a real policy conclusion.') => artefact(`${prefix}${id}`, kind, `Synthetic ${kind} ${id}`, statement, data, { refs, confidence: 0.5 });
  let items: Artefact[] = [];
  if (stage === 1) {
    const p = one('passage');
    const common = { refs: [p.id], origin: 'extracted_fact' as const, sourceId: p.id, sourceQuote: 'The Council is accountable for delivery and bears implementation costs.' };
    items = [
      { ...make('objective', 'claim', { category: 'objective', notes: 'The policy claims this objective; no evaluation is supplied.' }, [p.id]), ...common },
      { ...make('mechanism', 'mechanism', { intervention: 'Shared access programme', implementation: 'Council delivery', notes: 'Funding unspecified' }, [p.id]), ...common },
      make('assumption', 'assumption', { importance: 0.9, uncertainty: 0.9, consequence: 0.9, notes: 'Sufficient capacity is assumed.' }, [p.id, `${prefix}mechanism`, `${prefix}actor`]),
      { ...make('actor', 'actor', { entityType: 'local_authority', aliases: ['Council'], mentions: [p.id], ambiguity: 'None within this synthetic fixture.', dates: [], parent: null }, [p.id]), ...common, label: 'Council' },
    ];
  } else if (stage === 2) {
    const a = one('actor');
    items = [make('council', 'actor', { ...a.data, mentions: [a.id] }, [a.id])];
  } else if (stage === 3) {
    const a = input.artefacts.find((a) => a.kind === 'actor' && a.id.startsWith('s2_'))!;
    const m = one('mechanism');
    items = [make('node', 'node', { entityId: a.id }, [a.id]),
      { ...make('edge', 'edge', { notes: 'Paper assigns responsibility; authority not documented.' }, [a.id, m.id]), fromId: a.id, toId: m.id, relation: 'is_accountable_for', temporal: 'proposed' }];
  } else if (stage === 4) {
    const a = input.artefacts.find((a) => a.id === input.targetActorId)!;
    const fields = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, { value: 'Documented role or an explicit unknown in this synthetic fixture.', origin: 'structural_inference', confidence: null, refs: [a.id] }]));
    items = [make('profile', 'profile', { actorId: a.id, ...fields }, [a.id])];
  } else if (stage === 5) {
    items = [make('question', 'research_question', { importance: 0.9, uncertainty: 0.9, consequence: 0.9, rationale: 'Capacity changes feasibility.', searchStrategy: 'local authority implementation capacity evaluation', gap: 'Capacity is unverified.' }, [one('assumption').id])];
  } else if (stage === 6) {
    const c = one('claim');
    items = [make('evidence', 'evidence', { claimId: c.id, mechanismId: one('mechanism').id, actorId: one('actor').id, assumptionId: one('assumption').id, sourceId: c.sourceId, evidenceType: 'paper claim', result: 'insufficient', sourceQuality: 'Unverified policy proposal.', relevance: 'Direct', freshness: 'Unknown', dispute: 'No independent evaluation.' }, [c.id, one('assumption').id])];
  } else if (stage === 7) {
    items = PATTERNS.filter((p) => !input.targetPattern || input.targetPattern === p).map((pattern) => make(pattern, 'model', { pattern, players: [one('actor').id], strategies: ['Cooperate', 'Minimum compliance'], decisionOrder: 'Department commissions; Council responds.', information: 'Capacity is uncertain.', costs: 'Implementation effort.', benefits: 'Access improvements.', rewards: 'Unspecified.', sanctions: 'Unspecified.', dependencies: [one('mechanism').id], assumptions: [one('assumption').id], responses: ['Minimum compliance under capacity pressure.'], equilibria: ['Conditional compliance; qualitative hypothesis.'], explanation: 'Cooperation depends on resources and reciprocal incentives.', applicability: 'Synthetic semi-formal example.' }, [one('evidence').id, one('assumption').id, one('mechanism').id]));
  } else if (stage === 9) {
    items = SCENARIOS.filter((s) => !input.targetScenario || input.targetScenario === s).map((scenario) => make(scenario, 'scenario', { scenario, changedConditions: 'Capacity and cooperation vary.', firstActor: one('actor').id, strategy: 'Delay delivery when capacity is low.', downstreamEffects: ['Longer waits.'], affectedOutcomes: [one('claim').id], detectability: 'Monthly reports, subject to gaming.', correction: 'Review resourcing.', weaknesses: ['No assured capacity.'], assumptions: [one('assumption').id], sensitivity: ['If capacity is sufficient, cooperation is feasible; if not, minimum compliance becomes more plausible. Capacity most changes this result.'] }, [one('model').id, one('test').id, one('assumption').id]));
  } else if (stage === 10) {
    const sections = ['executive_assessment', 'scope_methodology', 'objectives', 'actors', 'mechanisms', 'high_risk_assumptions', 'test_results', 'strategic_responses', 'scenarios', 'evidence_gaps', 'confidence_uncertainty', 'distribution', 'unresolved_questions'];
    items = sections.map((section) => make(section, 'finding', { section, resultIds: [one('test').id], hypothesisIds: [one('assumption').id] }, [one('test').id, one('assumption').id]));
    items.push({ ...make('redesign', 'recommendation', { findingIds: [items[0].id], change: 'Commit resources and review authority.', tradeoffs: 'Additional public expenditure.', beneficiaries: ['Service users'], burdenBearers: ['Department'], validationNeeded: 'Verify capacity and legal powers.' }, [items[0].id]), origin: 'normative_judgement' });
  }
  return { artefacts: items, warnings: [] };
}
