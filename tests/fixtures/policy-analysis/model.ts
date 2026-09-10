// Synthetic provider responses used only by automated tests. Not a runtime fallback.
import { artefact, PATTERNS, SCENARIOS, PROFILE_FIELDS, REPORT_SECTIONS, type Artefact, type StageInput, type StageOutput } from '../../../src/lib/policy-analysis/contracts';
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
    const a = input.artefacts.find((x) => x.id === input.targetActorId)!;
    items = [make('exploit', 'exploit', { actorId: a.id, motivation: 'Avoids implementation cost while remaining compliant.', play: 'Report against the measure without changing the unobservable practice.', legality: 'compliant', targets: [one('mechanism').id], preconditions: [one('assumption').id], payoff: 'Retains discretion and avoids cost.', costToPolicy: 'The objective is not delivered while the measure reads well.', incentive: 0.6, ease: 0.6, impact: 0.6, concealment: 0.6, earlyWarning: 'Measure improves while complaints do not fall.', counter: 'Add an independent check of the unobservable practice.', precedent: 'None identified in this synthetic fixture.' }, [one('profile').id, one('mechanism').id, one('assumption').id])];
  } else if (stage === 11) {
    items = [];
  } else if (stage === 13) {
    const a = input.artefacts.find((x) => x.id === input.targetActorId)!;
    const profile = input.artefacts.find((x) => x.kind === 'profile' && x.data.actorId === a.id);
    const prior = (raw as { priorPersona?: { personaId?: string } | null }).priorPersona ?? null;
    const traits = [{ key: 'accountableTo', label: 'Who it answers to', value: 'A documented reporting line in this synthetic fixture.', origin: 'structural_inference', confidence: null }];
    items = [make('persona', 'persona_link', {
      personaId: prior?.personaId ?? null, personaName: a.label, entityType: String(a.data.entityType ?? 'concept'),
      actorId: a.id, aliases: [], summary: 'A synthetic body used only by automated tests.',
      traits, observed: traits, continuity: 'First sighting in this synthetic fixture.', divergence: 'None identified.',
    }, [a.id, ...(profile ? [profile.id] : [])])];
  } else if (stage === 12) {
    const sections = [...REPORT_SECTIONS];
    items = sections.map((section) => make(section, 'finding', { section, resultIds: [one('test').id], hypothesisIds: [one('assumption').id] }, [one('test').id, one('assumption').id]));
    items.push({ ...make('redesign', 'recommendation', { findingIds: [items[0].id], change: 'Commit resources and review authority.', tradeoffs: 'Additional public expenditure.', beneficiaries: ['Service users'], burdenBearers: ['Department'], validationNeeded: 'Verify capacity and legal powers.' }, [items[0].id]), origin: 'normative_judgement' });
  }
  return { artefacts: items, warnings: [] };
}
