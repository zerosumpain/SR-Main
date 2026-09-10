import { z } from 'zod';

export const STAGES = [
  'Document ingestion', 'Document decomposition', 'Entity resolution', 'Policy knowledge graph',
  'Actor and incentive profiles', 'Targeted research', 'Evidence matrix', 'Interaction models',
  'Automated policy tests', 'Adversarial scenarios and sensitivity', 'Exploitation playbook',
  'Cross-policy exposure', 'Synthesis',
] as const;
export const SYNTHESIS_STAGE = STAGES.length - 1;
export const PROMPT_VERSION = 'policy-analysis/2.0';
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_CHARACTERS = 600_000;
export const MAX_PAGES = 400;
export const DEPTHS = ['standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];
/**
 * What "run it for longer" actually buys. `rounds` is the one that matters: a
 * second round of research is planned FROM what the first round found, which is
 * how a line of enquiry gets developed rather than merely widened.
 */
export const DEPTH_LIMITS: Record<Depth, { questions: number; results: number; rounds: number; actors: number }> = {
  standard: { questions: 8, results: 3, rounds: 1, actors: 12 },
  deep: { questions: 12, results: 5, rounds: 3, actors: 20 },
};
export const TRIGGER = 'policy-analysis';
export const WORKFLOW_ID = 'policy-analysis-v1';
export const ORIGINS = ['extracted_fact', 'external_evidence', 'structural_inference', 'behavioural_hypothesis', 'model_result', 'normative_judgement'] as const;
export const RELATIONS = ['funds', 'regulates', 'commissions', 'delivers', 'reports_to', 'depends_on', 'supplies_data_to', 'has_authority_over', 'bears_cost_of', 'receives_benefit_from', 'is_accountable_for', 'can_veto', 'is_measured_by', 'is_exposed_to', 'supports', 'contradicts', 'assumes', 'provides_evidence_for', 'owns_data', 'reciprocates', 'sanctions', 'can_adapt', 'lobbies', 'allies_with', 'competes_with', 'appoints'] as const;
export const LEGALITY = ['compliant', 'grey', 'breach'] as const;
export const CROSS_PATTERNS = ['conflicting_demand', 'cumulative_burden', 'shared_assumption', 'regime_arbitrage', 'common_actor_overload', 'contradictory_measure', 'duplicated_authority'] as const;
export const PATTERNS = ['principal_agent', 'collective_action', 'coordination', 'metric_gaming', 'information_asymmetry', 'enforcement_credibility', 'bargaining_veto', 'repeated_interaction', 'regulatory_capture', 'coalition_formation'] as const;
export const SCENARIOS = ['genuine_cooperation', 'minimum_compliance', 'strategic_gaming', 'limited_capacity', 'leadership_change', 'active_opposition', 'poor_information', 'unequal_distribution'] as const;
const text = z.string().min(1).max(12000);
const strings = z.array(text).max(80);
const ids = z.array(z.string().max(100)).max(10000);
const unit = z.number().min(0).max(1);
export const confidenceSchema = unit.nullable().default(null);
const field = z.object({ value: text, origin: z.enum(ORIGINS), confidence: confidenceSchema, refs: ids }).strict();
export const PROFILE_FIELDS = ['formalRole', 'statedObjectives', 'operationalObjectives', 'accountableTo', 'successCriteria', 'timeHorizon', 'resources', 'constraints', 'legalPowers', 'informationPossessed', 'informationControlled', 'dependencies', 'costs', 'benefits', 'risks', 'outsideOption', 'gainFromFailure', 'reputationalIncentives', 'politicalIncentives', 'institutionalMotivations', 'strategies'] as const;
const profileFields = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, field])) as Record<(typeof PROFILE_FIELDS)[number], typeof field>;
export const dataSchemas = {
  passage: z.object({ documentHash: text }),
  claim: z.object({ category: z.enum(['objective', 'problem', 'responsibility', 'decision_right', 'funding', 'dependency', 'data_flow', 'measure', 'constraint', 'risk', 'benefit', 'claim', 'cited_evidence']), notes: text }),
  mechanism: z.object({ intervention: text, implementation: text, notes: text }),
  assumption: z.object({ importance: unit, uncertainty: unit, consequence: unit, priority: unit.optional(), notes: text }),
  actor: z.object({ entityType: z.enum(['person', 'department', 'agency', 'local_authority', 'provider', 'contractor', 'programme', 'dataset', 'legislation', 'committee', 'user_group', 'geography', 'concept']), aliases: strings, mentions: ids, ambiguity: text, dates: strings, parent: z.string().nullable() }),
  alias: z.object({ actorId: text }),
  resolution_candidate: z.object({ candidates: ids.min(2), reason: text, resolved: z.literal(false) }),
  node: z.object({ entityId: text }),
  edge: z.object({ notes: text }),
  profile: z.object({ actorId: text, ...profileFields }),
  research_question: z.object({ importance: unit, uncertainty: unit, consequence: unit, priority: unit.optional(), rationale: text, searchStrategy: text, gap: text }),
  research_source: z.object({ questionId: text, retrievedAt: text, quality: text, qualityBasis: text, freshness: text, jurisdictionalRelevance: text, retrieval: z.enum(['full_text', 'search_excerpt']), gap: text }),
  evidence: z.object({ claimId: z.string().nullable(), mechanismId: z.string().nullable(), actorId: z.string().nullable(), assumptionId: z.string().nullable(), sourceId: text, evidenceType: text, result: z.enum(['supports', 'contradicts', 'mixed', 'insufficient']), sourceQuality: text, relevance: text, freshness: text, dispute: text }),
  model: z.object({ pattern: z.enum(PATTERNS), players: ids, strategies: strings, decisionOrder: text, information: text, costs: text, benefits: text, rewards: text, sanctions: text, dependencies: ids, assumptions: ids.min(1), responses: strings, equilibria: strings, explanation: text, applicability: text }),
  test: z.object({ testId: text, rationale: text, inputs: ids, rule: text, reasoning: text, result: z.enum(['low_risk', 'moderate_risk', 'high_risk', 'indeterminate']), severity: z.enum(['low', 'moderate', 'high', 'unknown']), actors: ids, mitigation: text }),
  scenario: z.object({ scenario: z.enum(SCENARIOS), changedConditions: text, firstActor: z.string().nullable(), strategy: text, downstreamEffects: strings, affectedOutcomes: ids, detectability: text, correction: text, weaknesses: strings, assumptions: ids.min(1), sensitivity: strings.min(1) }),
  exploit: z.object({
    actorId: text, motivation: text, play: text, legality: z.enum(LEGALITY),
    targets: ids.min(1), preconditions: ids.min(1), payoff: text, costToPolicy: text,
    // Four factors a reader can name, each on [0,1]. `exposure` and `band` are
    // computed from them by the server so the ranking is reproducible.
    incentive: unit, ease: unit, impact: unit, concealment: unit,
    exposure: unit.optional(), band: z.string().max(40).optional(),
    earlyWarning: text, counter: text, precedent: text,
  }).strict(),
  cross_policy: z.object({
    pattern: z.enum(CROSS_PATTERNS), otherAnalysisId: z.string().max(100), otherAnalysisTitle: text,
    // Identifiers in ANOTHER analysis: recorded, never joined. Provenance rows may
    // not cross an analysis boundary, so these stay plain strings in `data`.
    otherArtefactIds: ids, actorId: z.string().nullable(),
    interaction: text, consequence: text, severity: unit, evidenceLimits: text, action: text,
  }).strict(),
  finding: z.object({ section: z.enum(['executive_assessment', 'scope_methodology', 'objectives', 'actors', 'mechanisms', 'high_risk_assumptions', 'test_results', 'strategic_responses', 'scenarios', 'exploitation', 'cross_policy', 'evidence_gaps', 'confidence_uncertainty', 'distribution', 'unresolved_questions']), resultIds: ids.min(1), hypothesisIds: ids.min(1) }),
  recommendation: z.object({ findingIds: ids.min(1), change: text, tradeoffs: text, beneficiaries: strings, burdenBearers: strings, validationNeeded: text }),
} as const;
export const REPORT_SECTIONS = ['executive_assessment', 'scope_methodology', 'objectives', 'actors', 'mechanisms', 'high_risk_assumptions', 'test_results', 'strategic_responses', 'scenarios', 'exploitation', 'cross_policy', 'evidence_gaps', 'confidence_uncertainty', 'distribution', 'unresolved_questions'] as const;
export type Kind = keyof typeof dataSchemas;
export const KINDS = Object.keys(dataSchemas) as [Kind, ...Kind[]];
// Every nullable field also DEFAULTS to null. A model that omits `toId` on an
// actor — where the field means nothing — is being reasonable, and on
// 2026-09-09 one such omission in one of eighteen artefacts failed the whole
// envelope and cost a passage of a live assessment. Absent and null mean the
// same thing here, so they are treated the same.
export const artefactSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), kind: z.enum(KINDS),
  label: z.string().min(1).max(300), statement: text, origin: z.enum(ORIGINS), confidence: confidenceSchema,
  refs: ids.default([]), sourceId: z.string().nullable().default(null), sourceQuote: z.string().max(12000).nullable().default(null),
  page: z.number().int().positive().nullable().default(null), section: z.string().max(300).nullable().default(null),
  startOffset: z.number().int().nonnegative().nullable().default(null), endOffset: z.number().int().nonnegative().nullable().default(null),
  url: z.string().nullable().default(null), fromId: z.string().nullable().default(null), toId: z.string().nullable().default(null),
  relation: z.enum(RELATIONS).nullable().default(null), temporal: z.enum(['proposed', 'current', 'historical', 'inferred']).nullable().default(null),
  data: z.record(z.string(), z.unknown()),
}).strict();

/**
 * The envelope, parsed WITHOUT its artefacts.
 *
 * `stageOutputSchema` types `artefacts` as an array of strict artefacts, so a
 * single malformed member fails the whole parse — before per-artefact triage can
 * quarantine it. That is precisely the all-or-nothing behaviour triage exists to
 * end, one level up. The runtime path parses this and then checks each artefact
 * on its own.
 */
export const looseOutputSchema = z.object({
  artefacts: z.array(z.unknown()).max(4000),
  warnings: z.array(z.unknown()).max(4000).optional(),
});
export type Artefact = z.infer<typeof artefactSchema>;
export type StageInput = { stage: number; title: string; depth?: Depth; graphLoss?: number; jurisdiction: string | null; policyArea: string | null; context: string | null; priorWarnings?: string[]; artefacts: Artefact[] };
export type StageOutput = { artefacts: Artefact[]; warnings: string[] };
export const stageOutputSchema = z.object({ artefacts: z.array(artefactSchema).max(2000), warnings: z.array(z.string().max(1000)).max(100) }).strict();
// Modelling, scenarios and the red team may all surface a hypothesis the
// document inventory did not, and they must be able to record it: a model whose
// `assumptions` point at ids that do not exist is refused, so forbidding the kind
// took the model down with it. Seen on a live run at stage 7, three patterns in
// a row.
export const STAGE_KINDS: Kind[][] = [
  ['passage'], ['claim', 'mechanism', 'assumption', 'actor'], ['actor', 'alias', 'resolution_candidate'],
  ['node', 'edge'], ['profile'], ['research_question', 'research_source'], ['evidence'], ['model', 'assumption'], ['test'], ['scenario', 'assumption'],
  ['exploit', 'assumption'], ['cross_policy'], ['finding', 'recommendation'],
];
export function artefact(id: string, kind: Kind, label: string, statement: string, data: Record<string, unknown>, overrides: Partial<Artefact> = {}): Artefact {
  return { id, kind, label, statement, data, origin: 'structural_inference', confidence: null, refs: [], sourceId: null, sourceQuote: null, page: null, section: null, startOffset: null, endOffset: null, url: null, fromId: null, toId: null, relation: null, temporal: null, ...overrides };
}
export function safeSourceUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    // External citations must not point at the site, local addresses, or special hosts.
    if (!u.hostname.includes('.') || /(^localhost$|\.local$|\.internal$|strangeramblings\.com$)/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
    return u.href;
  } catch { return null; }
}
