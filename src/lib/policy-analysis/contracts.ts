import { z } from 'zod';

export const STAGES = [
  'Document ingestion', 'Document decomposition', 'Entity resolution', 'Policy knowledge graph',
  'Actor and incentive profiles', 'Targeted research', 'Evidence matrix', 'Interaction models',
  'Automated policy tests', 'Adversarial scenarios and sensitivity', 'Exploitation playbook',
  'Cross-policy exposure', 'Synthesis', 'Actor persona library',
] as const;
/**
 * Fixed ordinals, not `STAGES.length - 1`.
 *
 * Synthesis stopped being the last stage when the persona library was appended
 * after it, and every rule that pins the report — which kinds synthesis may
 * emit, which results it must be shown — is written against ITS ordinal. Deriving
 * one of them from the array's length silently moved the report's contract onto
 * a stage that does not write a report. `stages.guard.test.ts` pins both names.
 */
export const SYNTHESIS_STAGE = 12;
export const PERSONA_STAGE = 13;
export const PROMPT_VERSION = 'policy-analysis/2.1';
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_CHARACTERS = 600_000;
export const MAX_PAGES = 400;
/**
 * How much of the assessment one call may carry, in characters.
 *
 * MEASURED 2026-09-10, against the bridge, with the real 2,278-artefact
 * inventory from the Post-16 white paper — never from the catalogue, because a
 * call that overruns the real window fails the stage rather than degrading.
 * gpt-5.6-luna answered every rung tried:
 *
 *   chars       artefacts     prompt tokens   wall
 *   360,000     153 of 2,278   74,014         16.8s   <- the old limit
 *   700,000     869           143,803         31.4s
 *   1,100,000   1,531         224,707         56.8s
 *   1,600,000   1,858         326,700         78.0s
 *   3,595,536   2,244         727,295         87.6s   <- the whole inventory
 *
 * NO CEILING WAS FOUND. So this is not set by the model's limit — it is set by
 * the three things that bite first:
 *
 *   COVERAGE. The old 360,000 carried 153 of 2,278 artefacts, 6.7%, which is why
 *   eight of fourteen stages logged "withheld from this call entirely" and the
 *   research stage planned its questions having seen no actor, claim or mechanism
 *   at all. 1,100,000 carries 67%. That is the whole point of the change.
 *
 *   DIMINISHING RETURNS. 360k to 1.1M buys 1,378 more artefacts. 1.1M to 1.6M
 *   buys 327 more for 45% more tokens and 37% more wall clock. The curve knees
 *   here.
 *
 *   ATTENTION AND QUOTA. A 200 is not comprehension: a model handed 727,000
 *   tokens does not attend to all of them evenly, and every token is subscription
 *   quota. The increase falls only on the calls that were actually shedding — the
 *   wide, late stages — since a stage-1 passage call carries one passage and is
 *   untouched.
 *
 * That leaves 224,707 tokens against 727,295 known to work: 3.2x of headroom for
 * a longer policy, a bigger system prompt, and the repair rounds that re-send on
 * top. Raise it again only against a fresh measurement.
 */
export const CONTEXT_LIMIT = 1_100_000;

/**
 * Room held back from the fit so a corrective round always has somewhere to go.
 *
 * The repair loop is what makes a retry meaningful: it carries the offending ids
 * and the broken rule back to the model, and it is how a play that failed the
 * provenance rule gets fixed instead of dropped. It is also the first thing to
 * die when the payload fills the window, because its room is computed as
 * `CONTEXT_LIMIT - sent - instruction - 2_000` and `sent` is whatever the fit
 * produced. Fit to the ceiling and that arithmetic goes negative.
 *
 * Measured on the verification run of 2026-09-10, immediately after the ceiling
 * was raised to 1,100,000: the exploitation playbook logged "There was no room
 * left in the model's context window for a corrective attempt", discarded seven
 * groups of output, and produced **12 plays across 8 actors against the previous
 * run's 31 across 10** — on the same document, the same model and the same twelve
 * calls. The plays were not judged bad; they failed a provenance rule and could
 * not be repaired.
 *
 * So the fit stops short of the ceiling. 60,000 characters is ~5% of the budget
 * and leaves a working instruction plus a useful echo of what the model got
 * wrong, which is the part that lets it correct itself.
 */
export const REPAIR_RESERVE = 60_000;
/** What a call may actually be filled to, leaving the reserve intact. */
export const FIT_LIMIT = CONTEXT_LIMIT - REPAIR_RESERVE;

export const DEPTHS = ['standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];
/**
 * How many units of a stage's fan-out may be in flight at once.
 *
 * Safe because the calls are independent BY CONSTRUCTION: every fan-out in
 * `executeStage` builds its context from `input.artefacts` alone and never from
 * what another unit produced, so N calls in flight return exactly what N calls
 * in sequence return. What is not order-free is the fold — see `fanOut`.
 *
 * Measured against the Codex bridge on 2026-09-10, replaying a real page of a
 * 72-page white paper through the real contract on gpt-5.6-luna:
 *
 *   agents   1      4      5      6
 *   wall     24.1s  33.6s  34.8s  33.7s
 *   per call 24.0s  29.8s  28.8s  26.8s
 *
 * No 429s at any level, and the per-call cost does not climb with N — four, five
 * and six all finish in about the same wall time, so six does half again as much
 * work as four for nothing. Six is the top of what was measured, not a ceiling
 * anybody found.
 *
 * The bridge has its own cap (`CODEX_BRIDGE_CONCURRENCY`, 3 by default) and
 * QUEUES past it, so asking for more agents than the bridge admits is not an
 * error and costs nothing — it simply stops going faster.
 */
export const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
export type Concurrency = (typeof CONCURRENCY_OPTIONS)[number];
/**
 * What an assessment with no stored preference does: one at a time.
 *
 * Every assessment before this option existed ran serially, and a run that is
 * mid-flight when this ships must carry on exactly as it started rather than
 * silently widening under it. The submission form suggests a higher number; a
 * NULL column does not.
 */
export const DEFAULT_CONCURRENCY: Concurrency = 1;
/**
 * What "run it for longer" actually buys. `rounds` is the one that matters: a
 * second round of research is planned FROM what the first round found, which is
 * how a line of enquiry gets developed rather than merely widened.
 */
export const DEPTH_LIMITS: Record<Depth, { questions: number; results: number; rounds: number; actors: number }> = {
  standard: { questions: 8, results: 3, rounds: 1, actors: 12 },
  deep: { questions: 12, results: 5, rounds: 3, actors: 20 },
};
/**
 * The persona dossier vocabulary: twelve traits that survive a change of policy.
 *
 * Deliberately NOT the twenty-one profile fields. A profile answers "what does
 * this body want from THIS paper", which is exactly the part that does not
 * travel; a persona answers "what is this body, and what does its position
 * reward", which does. The keys are fixed so two assessments a year apart can be
 * compared line for line rather than merged into prose.
 */
export const PERSONA_TRAITS = [
  ['mandate', 'What it exists to do'],
  ['accountableTo', 'Who it answers to'],
  ['judgedOn', 'What it is judged on'],
  ['timeHorizon', 'How far ahead it can afford to look'],
  ['resources', 'What it can bring to bear'],
  ['legalPowers', 'What it can compel or block'],
  ['informationControl', 'What it knows that others do not'],
  ['constraints', 'What limits it'],
  ['outsideOption', 'What it does if it declines to play'],
  ['gainFromFailure', 'Who around it is better off if a policy fails'],
  ['standingStrategies', 'How it typically plays'],
  ['reputation', 'How it is regarded, and its track record'],
] as const;
export type TraitKey = (typeof PERSONA_TRAITS)[number][0];
export const TRAIT_LABELS: Record<string, string> = Object.fromEntries(PERSONA_TRAITS);

export const TRIGGER = 'policy-analysis';
export const WORKFLOW_ID = 'policy-analysis-v1';
// `prior_assessment` is what the persona library contributes: something an
// EARLIER assessment of a DIFFERENT policy established about this body. It is
// not evidence about the policy in hand — nothing carrying it can reach a
// passage or a retrieved source, so `hasSource` keeps it out of the findings on
// its own account — and the reader must be able to see which of these came from
// somewhere else.
export const ORIGINS = ['extracted_fact', 'external_evidence', 'structural_inference', 'behavioural_hypothesis', 'model_result', 'normative_judgement', 'prior_assessment'] as const;
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
/**
 * A persona trait carries its own origin and confidence.
 *
 * The dossier is drawn from several assessments of several policies, so "who
 * this body answers to" may be an extracted fact in one paper and an inference
 * in another. Averaging that away would be the whole problem: a trait states its
 * epistemic status, and the page shows it.
 */
const personaTraits = z.array(z.object({ key: z.string().max(60), label: z.string().max(120), value: text, origin: z.enum(ORIGINS), confidence: confidenceSchema }).strict()).max(30);
export const dataSchemas = {
  passage: z.object({ documentHash: text }),
  claim: z.object({ category: z.enum(['objective', 'problem', 'responsibility', 'decision_right', 'funding', 'dependency', 'data_flow', 'measure', 'constraint', 'risk', 'benefit', 'claim', 'cited_evidence']), notes: text }),
  mechanism: z.object({ intervention: text, implementation: text, notes: text }),
  assumption: z.object({ importance: unit, uncertainty: unit, consequence: unit, priority: unit.optional(), notes: text }),
  actor: z.object({ entityType: z.enum(['person', 'department', 'agency', 'local_authority', 'provider', 'contractor', 'programme', 'dataset', 'legislation', 'committee', 'user_group', 'geography', 'concept']), aliases: strings, mentions: ids, ambiguity: text, dates: strings, parent: z.string().nullable() }),
  alias: z.object({ actorId: text }),
  resolution_candidate: z.object({ candidates: ids.min(2), reason: text, resolved: z.literal(false) }),
  edge: z.object({ notes: text }),
  // `coversActorIds` is stamped by the SERVER after the call, never asked of the
  // model: entity resolution deliberately refuses to merge rows that share a
  // label, so this records which rows one profile was drawn for without
  // asserting they are one body. Optional because a profile from before this
  // existed, or from a single-row group, carries none.
  profile: z.object({ actorId: text, coversActorIds: ids.optional(), ...profileFields }),
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
  persona_link: z.object({
    // The persona this actor was matched to, echoed back from the candidates the
    // server supplied. Null means "no existing persona fits" and a new one is
    // opened. An id the server did not supply is treated as null rather than
    // trusted — the model cannot mint a row in the reader's library.
    personaId: z.string().max(100).nullable(),
    personaName: text, entityType: text, actorId: text, aliases: strings,
    summary: text,
    // The standing dossier AFTER this assessment, and what this assessment on
    // its own establishes. Kept apart on purpose: the first is cumulative and
    // the second is the row that survives if another assessment is deleted.
    traits: personaTraits, observed: personaTraits,
    continuity: text, divergence: text,
  }).strict(),
} as const;
/**
 * The kinds a `finding` may cite as its result.
 *
 * Read in two places that must not drift: `relationalFault` rejects a conclusion
 * citing anything else, and synthesis pins exactly these into its model call so
 * the context budget can never shed what the rule then demands.
 */
export const RESULT_KINDS = ['test', 'model', 'scenario', 'exploit', 'cross_policy'] as const;

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
/**
 * `sealed` is here so two stages can say the RIGHT thing rather than a true one.
 *
 * A sealed run is handed no neighbours and no persona priors, and from inside the
 * pipeline that is indistinguishable from having none — so stage 11 told the
 * reader "no other assessment was available to compare", which is not why. A
 * chapter that is missing on purpose has to say so on purpose.
 */
export type StageInput = { stage: number; title: string; depth?: Depth; graphLoss?: number; sealed?: boolean; jurisdiction: string | null; policyArea: string | null; context: string | null; priorWarnings?: string[]; artefacts: Artefact[] };
export type StageOutput = { artefacts: Artefact[]; warnings: string[] };
export const stageOutputSchema = z.object({ artefacts: z.array(artefactSchema).max(2000), warnings: z.array(z.string().max(1000)).max(100) }).strict();
// Modelling, scenarios and the red team may all surface a hypothesis the
// document inventory did not, and they must be able to record it: a model whose
// `assumptions` point at ids that do not exist is refused, so forbidding the kind
// took the model down with it. Seen on a live run at stage 7, three patterns in
// a row.
export const STAGE_KINDS: Kind[][] = [
  ['passage'], ['claim', 'mechanism', 'assumption', 'actor'], ['actor', 'alias', 'resolution_candidate'],
  ['edge'], ['profile'], ['research_question', 'research_source'], ['evidence'], ['model', 'assumption'], ['test'], ['scenario', 'assumption'],
  ['exploit', 'assumption'], ['cross_policy'], ['finding', 'recommendation', 'assumption'], ['persona_link'],
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
