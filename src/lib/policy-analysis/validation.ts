import { dataSchemas, STAGE_KINDS, stageOutputSchema, type Artefact, type StageOutput } from './contracts';

export class PolicyError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function validateOutput(raw: unknown, stage: number, prior: Artefact[]): StageOutput {
  const parsed = stageOutputSchema.safeParse(raw);
  if (!parsed.success) throw new PolicyError('contract', 'The model returned an invalid structured result. Resume to retry.');
  const output = parsed.data;
  const all = new Map(prior.map((a) => [a.id, a]));
  for (const a of output.artefacts) {
    if (all.has(a.id)) throw new PolicyError('duplicate', 'The model returned duplicate artefact identifiers.');
    if (!STAGE_KINDS[stage]?.includes(a.kind) || !dataSchemas[a.kind].safeParse(a.data).success) throw new PolicyError('contract', 'An artefact did not match its stage contract.');
    all.set(a.id, a);
  }
  for (const a of output.artefacts) {
    if (a.kind !== 'passage' && !a.refs.length) throw new PolicyError('provenance', 'An artefact has no supporting evidence links.');
    if (a.refs.some((id) => id === a.id || !all.has(id))) throw new PolicyError('provenance', 'An artefact cites an unavailable source.');
    if (stage === 1 && ['claim', 'mechanism', 'actor'].includes(a.kind) && a.origin !== 'extracted_fact') throw new PolicyError('extraction', 'The document inventory must distinguish literal extraction from assumptions.');
    if (a.kind === 'edge' && (!a.fromId || !a.toId || !all.has(a.fromId) || !all.has(a.toId) || !a.relation || !a.temporal)) throw new PolicyError('graph', 'A graph assertion has invalid endpoints or provenance.');
    if (a.origin === 'extracted_fact' && a.kind !== 'passage') {
      const source = a.sourceId ? all.get(a.sourceId) : null;
      if (source?.kind !== 'passage' || !a.sourceQuote || !source.statement.includes(a.sourceQuote) || !a.refs.includes(source.id)) throw new PolicyError('span', 'An extracted assertion could not be located in the policy text.');
      a.page = source.page; a.section = source.section;
      a.startOffset = (source.startOffset ?? 0) + source.statement.indexOf(a.sourceQuote);
      a.endOffset = a.startOffset + a.sourceQuote.length;
    }
    // URLs originate exclusively in trusted research adapter results, never model output.
    if (a.url && a.kind !== 'research_source') throw new PolicyError('citation', 'Model-authored URLs are not accepted as evidence.');
    if (a.sourceId && !all.has(a.sourceId)) throw new PolicyError('source', 'The source reference is unavailable.');
    const actorTargets = a.kind === 'model' ? a.data.players as string[] : a.kind === 'edge' ? [a.fromId, a.toId] : a.kind === 'profile' ? [a.data.actorId] : a.kind === 'node' ? [a.data.entityId] : [];
    if (actorTargets.some((id) => typeof id === 'string' && all.get(id)?.kind === 'actor' && !id.startsWith('s2_'))) throw new PolicyError('canonical', 'Graph assertions, profiles and models must use resolved actor identifiers.');
    if (a.kind === 'assumption' && !a.refs.some((id) => ['actor', 'mechanism'].includes(all.get(id)?.kind ?? ''))) throw new PolicyError('hypothesis', 'An assumption must link to an affected actor or mechanism.');
    if (a.kind === 'model' && !(a.data.assumptions as string[]).every((id) => a.refs.includes(id))) throw new PolicyError('hypothesis', 'Interaction models must link their assumptions into provenance.');
    if (a.origin === 'normative_judgement' && a.kind === 'research_source') throw new PolicyError('source', 'A recommendation is not an external source.');
    if (a.kind === 'recommendation' && a.origin !== 'normative_judgement') throw new PolicyError('recommendation', 'Redesign options must be labelled as normative recommendations.');
    if (a.kind === 'profile') {
      for (const value of Object.values(a.data)) {
        if (typeof value !== 'object' || !value || !('refs' in value)) continue;
        const f = value as { refs: string[]; confidence: number | null };
        if (f.refs.some((r) => !all.has(r)) || (!f.refs.length && f.confidence !== null)) throw new PolicyError('profile', 'An incentive profile field lacks evidence or explicit uncertainty.');
      }
    }
    const referencedFields = ['actorId', 'entityId', 'questionId', 'sourceId', 'claimId', 'mechanismId', 'assumptionId', 'firstActor'];
    for (const field of referencedFields) {
      const value = a.data[field];
      if (typeof value === 'string' && !all.has(value)) throw new PolicyError('reference', 'An artefact contains an invalid entity reference.');
    }
    for (const field of ['players', 'assumptions', 'resultIds', 'hypothesisIds', 'findingIds', 'candidates', 'mentions', 'dependencies', 'affectedOutcomes']) {
      const values = a.data[field];
      if (Array.isArray(values) && values.some((v) => typeof v !== 'string' || !all.has(v))) throw new PolicyError('reference', 'An artefact contains an invalid relationship.');
    }
  }
  for (const a of output.artefacts) {
    if (!hasSource(a.id, all)) throw new PolicyError('traceability', 'An artefact has no traceable path to policy text or external evidence.');
    if (a.kind === 'finding') {
      const results = a.data.resultIds as string[];
      const hypotheses = a.data.hypothesisIds as string[];
      if (!results.every((id) => ['test', 'model', 'scenario'].includes(all.get(id)?.kind ?? '')) || !hypotheses.every((id) => all.get(id)?.kind === 'assumption')) throw new PolicyError('traceability', 'A conclusion must cite a test or model and its hypotheses.');
      if (!hypotheses.every((hypothesis) => results.some((result) => reaches(result, hypothesis, all)))) throw new PolicyError('traceability', 'A conclusion’s hypotheses must support its cited results.');
      for (const id of [...results, ...hypotheses]) if (!a.refs.includes(id)) throw new PolicyError('traceability', 'A conclusion is missing a provenance link.');
    }
  }
  return output;
}
export function hasSource(id: string, all: Map<string, Artefact>, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const a = all.get(id);
  if (!a) return false;
  if (a.kind === 'passage' || a.kind === 'research_source') return true;
  return a.refs.some((r) => hasSource(r, all, new Set(seen)));
}

export function reaches(from: string, to: string, all: Map<string, Artefact>, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return all.get(from)?.refs.some((id) => reaches(id, to, all, new Set(seen))) ?? false;
}
