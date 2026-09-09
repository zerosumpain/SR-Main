import { z } from 'zod';
import { mulberry32 } from '../simulation/random';
import { candidateSchema, pendingApproval, type Candidate, type PolicySource, type RunConfig } from './schemas';
import { profiles, profileKey, resetApprovals, reviewItems, validateModel } from './validation';

export const AUTO_RESOLVE_VERSION = 'illustrative-setup-1.0.0';
export const autoResolveOptions = z.object({ seed: z.number().int().min(0).max(4294967295), low: z.number().finite().min(-1e6).max(1e6), high: z.number().finite().min(-1e6).max(1e6) }).strict().refine(v => v.low <= v.high, 'Sample range must be ordered');
export interface AutoResolution { version: string; seed: number; range: { low: number; high: number }; candidate: Candidate; config: RunConfig; changes: string[]; errors: string[] }
/** Numerical values come from seeded code, never from model prose. No approval occurs here. */
export function prepareIllustrative(input: Candidate, source: PolicySource, options: unknown): AutoResolution {
  const { seed, low, high } = autoResolveOptions.parse(options);
  const candidate = candidateSchema.parse(structuredClone(input)); const game = candidate.game;
  game.approval_status = pendingApproval(); game.assumptions = [...game.assumptions];
  const rng = mulberry32(seed); const changes: string[] = [];
  const used = new Set(reviewItems(game).map(i => i.id)); let serial = 0;
  const id = () => { let key; do { key = `auto-${++serial}`; } while (used.has(key)); used.add(key); return key; };
  const samplingSource = `${AUTO_RESOLVE_VERSION}; seeded uniform ${Number.isInteger(low) && Number.isInteger(high) ? 'integer' : 'continuous'} illustrative sample; seed ${seed}; range [${low}, ${high}]. Not estimated from policy evidence.`;
  const sampled = () => Number.isInteger(low) && Number.isInteger(high) ? low + Math.floor(rng() * (high - low + 1)) : low + rng() * (high - low);
  const structuralId = id();
  game.assumptions.push({ id: structuralId, statement: 'Optional illustrative completion supplies missing model structure and samples unknown numbers. These choices explore a toy model, not real behaviour.', type: 'structural', value_or_range: null, source: AUTO_RESOLVE_VERSION, confidence: 'illustrative', approved_by_user: false, sensitivity_priority: 'high', approval_status: pendingApproval() });
  const provenance = { evidence_refs: [], assumption_refs: [structuralId] };
  const statement = (words: string) => ({ id: id(), statement: words, approval_status: pendingApproval(), ...provenance });
  const numeric = (words: string) => {
    const key = id(); game.assumptions.push({ id: key, statement: words, type: 'numerical', value_or_range: { low, central: sampled(), high }, source: samplingSource, confidence: 'illustrative', approved_by_user: false, sensitivity_priority: 'high', approval_status: pendingApproval() });
    changes.push(`Added illustrative value: ${words}`); return key;
  };
  for (const a of game.assumptions) if (a.type === 'numerical' && a.value_or_range === null) {
    a.value_or_range = { low, central: sampled(), high }; a.source = samplingSource; a.confidence = 'illustrative'; changes.push(`Sampled previously unknown value: ${a.statement}`);
  }
  for (const actor of game.actors) {
    if (!actor.objectives.length) { actor.objectives.push(statement('Illustrative objective: improve this group’s calculated payoff.')); changes.push(`Added a hypothetical objective for ${actor.name}`); }
    if (!game.strategies.some(s => s.actor_id === actor.id)) {
      for (const name of ['Keep current approach', 'Change approach']) game.strategies.push({ id: id(), actor_id: actor.id, name, description: 'Illustrative option; feasibility has not been established by the policy.', preconditions: [], expected_direct_effects: [], approval_status: pendingApproval(), ...provenance });
      changes.push(`Added two illustrative choices for ${actor.name}`);
    }
    if (!game.payoff_components.some(p => p.actor_id === actor.id)) {
      const metric = game.outcome_metrics[0]; game.payoff_components.push({ id: id(), actor_id: actor.id, outcome_metric_id: metric.id, weight_or_range: numeric(`Illustrative importance of ${metric.name} to ${actor.name}`), rationale: 'Optional illustrative completion', provenance: samplingSource, approval_status: pendingApproval(), ...provenance });
    }
    if (!game.decision_rules.some(r => r.actor_id === actor.id)) {
      const rule = (['maximise', 'risk-averse', 'imitate'] as const)[Math.floor(rng() * 3)];
      game.decision_rules.push({ id: id(), actor_id: actor.id, rule, threshold_assumption: null, schedule: [], approval_status: pendingApproval(), ...provenance }); changes.push(`Sampled a ${rule} decision rule for ${actor.name}`);
    }
  }
  const ensureNumber = (key: string | null, words: string) => game.assumptions.some(a => a.id === key && a.type === 'numerical') ? key! : numeric(words);
  for (const p of game.payoff_components) p.weight_or_range = ensureNumber(p.weight_or_range, `Importance for ${p.actor_id} / ${p.outcome_metric_id}`);
  for (const r of game.decision_rules) {
    if (r.rule === 'satisfice') r.threshold_assumption = ensureNumber(r.threshold_assumption, `Satisfactory value for ${r.actor_id}`);
    if (r.rule === 'rule-based' && (!r.schedule.length || r.schedule.at(-1)!.through_round < 1000)) {
      const choice = r.schedule.at(-1)?.strategy_id ?? game.strategies.find(s => s.actor_id === r.actor_id)?.id;
      if (choice) { r.schedule.push({ through_round: 1000, strategy_id: choice }); changes.push(`Extended illustrative choice schedule for ${r.actor_id}`); }
    }
  }
  for (const profile of profiles(game)) if (!game.payoff_table.some(r => profileKey(r.profile) === profileKey(profile))) {
    game.payoff_table.push({ id: id(), profile, outcome_values: {}, approval_status: pendingApproval(), ...provenance }); changes.push('Added a missing combination of choices');
  }
  for (const row of game.payoff_table) for (const m of game.outcome_metrics) row.outcome_values[m.id] = ensureNumber(row.outcome_values[m.id], `${m.name} for choices ${Object.values(row.profile).join(' / ')}`);
  for (const item of reviewItems(game)) if (!('value_or_range' in item) && !(item.evidence_refs as string[]).length && !(item.assumption_refs as string[]).length) { item.assumption_refs = [structuralId]; changes.push(`Labelled unsupported item ${item.id} as an illustrative assumption`); }
  for (const key of ['objectives', 'operative_mechanisms', 'intended_outcomes'] as const) if (!game[key].length) { game[key].push(statement(`Illustrative ${key.replaceAll('_', ' ')}: compare the configured choices using the calculated outcome measure. Actual policy intent is not established.`)); changes.push(`Added hypothetical ${key.replaceAll('_', ' ')}`); }
  game.model_limitations = [...game.model_limitations.slice(0, 49), `${samplingSource} Optional setup accepted only for exploration; approvals do not establish realism.`];
  candidate.game = resetApprovals(game);
  const config: RunConfig = { simulation_type: (['normal-form', 'repeated', 'agent-based'] as const)[Math.floor(rng() * 3)], seed, rounds: 20, scenario: 'custom', scenario_name: `Illustrative sampled scenario (seed ${seed})`, parameters: {} };
  // Schema/semantic/evidence problems remain explicit, never erased to bypass a gate.
  candidateSchema.parse(candidate);
  return { version: AUTO_RESOLVE_VERSION, seed, range: { low, high }, candidate, config, changes, errors: validateModel(candidate.game, candidate.evidence, source, false) };
}
