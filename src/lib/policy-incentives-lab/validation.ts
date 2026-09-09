import type { Approval, EvidenceItem, PolicyGame, PolicySource } from './schemas';

export interface ReviewItem { id: string; approval_status: Approval; [key: string]: unknown }
export function reviewItems(game: PolicyGame): ReviewItem[] {
  const items: ReviewItem[] = [];
  function walk(v: unknown): void {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.id === 'string' && o.approval_status) items.push(o as ReviewItem);
    Object.entries(o).filter(([k]) => k !== 'approval_status').forEach(([, x]) => walk(x));
  }
  walk(game);
  return items;
}
export function resetApprovals(game: PolicyGame): PolicyGame {
  const copy = structuredClone(game);
  copy.approval_status = { status: 'pending', approved_by: null, approved_at: null };
  for (const item of reviewItems(copy)) {
    item.approval_status = { status: 'pending', approved_by: null, approved_at: null };
    if ('approved_by_user' in item) item.approved_by_user = false;
  }
  return copy;
}
export function profiles(game: PolicyGame): Record<string, string>[] {
  let rows: Record<string, string>[] = [{}];
  for (const actor of game.actors) {
    const options = game.strategies.filter(s => s.actor_id === actor.id);
    if (rows.length * options.length > 4096) throw new Error('Game exceeds 4096 strategy profiles');
    rows = rows.flatMap(p => options.map(s => ({ ...p, [actor.id]: s.id })));
  }
  return rows;
}
export function profileKey(profile: Record<string, string>): string {
  return Object.keys(profile).sort().map(k => `${k}:${profile[k]}`).join('|');
}
export function validateModel(game: PolicyGame, evidence: EvidenceItem[], source: PolicySource, requireApproval = true): string[] {
  const errors: string[] = [];
  const items = reviewItems(game);
  const ids = new Set<string>();
  const evidenceIds = new Set(evidence.map(e => e.id));
  if (evidenceIds.size !== evidence.length) errors.push('Duplicate evidence IDs');
  const assumptions = new Map(game.assumptions.map(a => [a.id, a]));
  for (const e of evidence) {
    const section = source.text_sections.find(s => s.location === e.location);
    if (e.source_id !== source.id || !section?.text.includes(e.quotation)) errors.push(`Evidence ${e.id}: quotation/location does not match the source`);
  }
  for (const item of items) {
    if (ids.has(item.id)) errors.push(`Duplicate item ID: ${item.id}`);
    ids.add(item.id);
    if (requireApproval && (item.approval_status.status !== 'approved' || !item.approval_status.approved_by || !item.approval_status.approved_at)) errors.push(`Approval required: ${item.id}`);
    const er = (item.evidence_refs ?? []) as string[];
    const ar = (item.assumption_refs ?? []) as string[];
    if (!('value_or_range' in item) && er.length + ar.length === 0) errors.push(`Evidence or labelled assumption required: ${item.id}`);
    for (const ref of er) if (!evidenceIds.has(ref)) errors.push(`Unknown evidence ${ref} on ${item.id}`);
    for (const ref of ar) if (!assumptions.has(ref)) errors.push(`Unknown assumption ${ref} on ${item.id}`);
  }
  for (const a of game.assumptions) {
    if (a.type === 'numerical' && a.value_or_range === null) errors.push(`Unknown numerical value: ${a.id}`);
    if (requireApproval && !a.approved_by_user) errors.push(`Assumption not approved by user: ${a.id}`);
  }
  const actors = new Set(game.actors.map(a => a.id));
  const metrics = new Set(game.outcome_metrics.map(m => m.id));
  const numeric = (id: string, context: string) => {
    const a = assumptions.get(id);
    if (!a || a.type !== 'numerical' || a.value_or_range === null) errors.push(`Missing numerical assumption ${id}: ${context}`);
  };
  for (const a of game.actors) {
    if (!a.objectives.length) errors.push(`Actor ${a.id} needs an objective`);
    if (!game.strategies.some(s => s.actor_id === a.id)) errors.push(`Actor ${a.id} needs strategies`);
    if (!game.payoff_components.some(p => p.actor_id === a.id)) errors.push(`Actor ${a.id} needs payoff components`);
    if (game.decision_rules.filter(r => r.actor_id === a.id).length !== 1) errors.push(`Actor ${a.id} needs exactly one decision rule`);
  }
  for (const s of game.strategies) if (!actors.has(s.actor_id)) errors.push(`Unknown actor: ${s.actor_id}`);
  const components = new Set<string>();
  for (const p of game.payoff_components) {
    if (!actors.has(p.actor_id) || !metrics.has(p.outcome_metric_id)) errors.push(`Invalid payoff component: ${p.id}`);
    const key = `${p.actor_id}:${p.outcome_metric_id}`;
    if (components.has(key)) errors.push(`Duplicate payoff component: ${key}`);
    components.add(key); numeric(p.weight_or_range, p.id);
  }
  for (const r of game.decision_rules) {
    if (!actors.has(r.actor_id)) errors.push(`Unknown decision actor: ${r.id}`);
    if (r.rule === 'satisfice') {
      if (!r.threshold_assumption) errors.push(`Satisficing threshold required: ${r.id}`);
      else numeric(r.threshold_assumption, r.id);
    }
    if (r.rule === 'rule-based' && !r.schedule.length) errors.push(`Rule schedule required: ${r.id}`);
    for (const s of r.schedule) if (!game.strategies.some(x => x.id === s.strategy_id && x.actor_id === r.actor_id)) errors.push(`Invalid scheduled strategy: ${r.id}`);
    if (r.schedule.some((s, i) => i > 0 && s.through_round <= r.schedule[i - 1].through_round)) errors.push(`Rule schedule must be ordered: ${r.id}`);
  }
  for (const i of game.interactions) {
    if (i.actor_ids.some(a => !actors.has(a)) || new Set(i.actor_ids).size !== i.actor_ids.length) errors.push(`Invalid interaction actors: ${i.id}`);
  }
  const keys = new Set<string>();
  for (const row of game.payoff_table) {
    const key = profileKey(row.profile);
    if (keys.has(key)) errors.push(`Duplicate payoff profile: ${row.id}`);
    keys.add(key);
    if (Object.keys(row.profile).length !== actors.size || game.actors.some(a => !game.strategies.some(s => s.id === row.profile[a.id] && s.actor_id === a.id))) errors.push(`Invalid profile: ${row.id}`);
    if (Object.keys(row.outcome_values).length !== metrics.size || [...metrics].some(m => !row.outcome_values[m])) errors.push(`Incomplete outcomes: ${row.id}`);
    Object.values(row.outcome_values).forEach(a => numeric(a, row.id));
  }
  try { for (const p of profiles(game)) if (!keys.has(profileKey(p))) errors.push(`Missing payoff profile: ${profileKey(p)}`); }
  catch (e) { errors.push((e as Error).message); }
  if (!game.intended_outcomes.length || !game.objectives.length || !game.operative_mechanisms.length) errors.push('Intended outcomes, objectives and operative mechanisms are required');
  return errors;
}
