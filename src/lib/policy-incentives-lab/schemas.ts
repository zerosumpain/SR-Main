import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const text = z.string().trim().min(1).max(12000);
const refs = z.array(id).max(200);
const number = z.number().finite().min(-1e9).max(1e9);
export const approvalSchema = z.object({
  status: z.enum(['pending', 'approved']).default('pending'),
  approved_by: z.string().nullable().default(null),
  approved_at: z.string().nullable().default(null),
}).strict();
export const pendingApproval = () => ({ status: 'pending' as const, approved_by: null, approved_at: null });
const provenance = {
  evidence_refs: refs,
  assumption_refs: refs,
};
const review = { id, approval_status: approvalSchema };
export const statementSchema = z.object({ ...review, statement: text, ...provenance }).strict();
export const sourceSchema = z.object({
  id, title: text, publisher: text,
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source_url: z.union([z.literal(''), z.url().refine(v => /^https?:/.test(v), 'Use an HTTP(S) publication URL')]),
  document_hash: z.string(), synthetic: z.boolean(),
  text_sections: z.array(z.object({ id, location: text, text: z.string().max(250000) }).strict()).min(1).max(500),
  input_flags: z.array(z.string()).default([]),
}).strict();
export const evidenceSchema = z.object({
  id, source_id: id, quotation: text, location: text,
  explicit_or_inferred: z.enum(['explicit', 'inferred']),
  confidence: z.enum(['high', 'medium', 'low', 'uncertain']), extraction_method: text,
}).strict();
const statements = z.array(statementSchema).max(50);
export const actorSchema = z.object({
  ...review, name: text, description: text, objectives: statements, constraints: statements,
  resources: statements, information_available: statements, information_hidden: statements, ...provenance,
}).strict();
export const strategySchema = z.object({
  ...review, actor_id: id, name: text, description: text, preconditions: statements,
  expected_direct_effects: statements, ...provenance,
}).strict();
export const outcomeSchema = z.object({
  ...review, name: text, description: text, unit: text,
  desired_direction: z.enum(['increase', 'decrease', 'target']),
  policy_priority: z.enum(['primary', 'secondary']), measurement_limitations: text, ...provenance,
}).strict();
export const assumptionSchema = z.object({
  ...review, statement: text, type: z.enum(['numerical', 'behavioural', 'causal', 'structural']),
  value_or_range: z.union([number, z.object({ low: number, central: number, high: number }).strict().refine(v => v.low <= v.central && v.central <= v.high, 'Range must be ordered'), z.null()]),
  source: text, confidence: z.enum(['illustrative', 'user-supplied', 'unknown']),
  approved_by_user: z.boolean().default(false), sensitivity_priority: z.enum(['high', 'medium', 'low']),
}).strict();
export const payoffSchema = z.object({
  ...review, actor_id: id, outcome_metric_id: id, weight_or_range: id,
  rationale: text, provenance: text, ...provenance,
}).strict();
export const interactionSchema = z.object({
  ...review, actor_ids: refs.min(2), sequence: z.number().int().min(0),
  information_structure: z.enum(['observable', 'hidden']), repeat_frequency: text,
  dependency: text, ...provenance,
}).strict();
export const decisionSchema = z.object({
  ...review, actor_id: id,
  rule: z.enum(['maximise', 'satisfice', 'risk-averse', 'imitate', 'rule-based']),
  threshold_assumption: id.nullable(),
  schedule: z.array(z.object({ through_round: z.number().int().min(1).max(1000), strategy_id: id }).strict()).max(100),
  ...provenance,
}).strict();
export const rowSchema = z.object({
  ...review, profile: z.record(id, id), outcome_values: z.record(id, id), ...provenance,
}).strict();
export const gameSchema = z.object({
  version: z.number().int().min(1), approval_status: approvalSchema,
  objectives: statements, operative_mechanisms: statements,
  actors: z.array(actorSchema).min(1).max(6), strategies: z.array(strategySchema).min(1).max(30),
  outcome_metrics: z.array(outcomeSchema).min(1).max(20), payoff_components: z.array(payoffSchema).max(120),
  interactions: z.array(interactionSchema).max(100), assumptions: z.array(assumptionSchema).max(2000),
  intended_outcomes: statements, causal_relationships: statements,
  payoff_table: z.array(rowSchema).min(1).max(4096), decision_rules: z.array(decisionSchema).max(6),
  model_limitations: z.array(text).min(1).max(50),
}).strict();
export const candidateSchema = z.object({ evidence: z.array(evidenceSchema).max(500), game: gameSchema }).strict();
export const runConfigSchema = z.object({
  simulation_type: z.enum(['normal-form', 'sequential', 'repeated', 'agent-based']),
  seed: z.number().int().min(0).max(4294967295), rounds: z.number().int().min(1).max(1000),
  scenario: z.enum(['baseline', 'optimistic', 'adverse', 'custom']),
  scenario_name: z.string().trim().max(200).optional(),
  parameters: z.record(id, number),
}).strict();
export const sensitivitySchema = z.object({
  config: runConfigSchema,
  ranges: z.array(z.object({ assumption_id: id, low: number, high: number, steps: z.number().int().min(2).max(11) }).strict().refine(v => v.low <= v.high)).min(1).max(8),
}).strict();
export type PolicySource = z.infer<typeof sourceSchema>;
export type EvidenceItem = z.infer<typeof evidenceSchema>;
export type PolicyGame = z.infer<typeof gameSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type Strategy = z.infer<typeof strategySchema>;
export type OutcomeMetric = z.infer<typeof outcomeSchema>;
export type PayoffComponent = z.infer<typeof payoffSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type RunConfig = z.infer<typeof runConfigSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Approval = z.infer<typeof approvalSchema>;

export const GOVERNANCE = 'Exploratory scenarios, not forecasts. Artificial agents do not reproduce real human behaviour. Outputs require policy, analytical, legal, financial and operational review. Only public or synthetic material may be used. Do not upload personal data, departmental documents, internal drafts or operationally sensitive content.';
