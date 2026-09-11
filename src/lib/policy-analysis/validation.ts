import { artefactSchema, dataSchemas, looseOutputSchema, RESULT_KINDS, STAGE_KINDS, stageOutputSchema, type Artefact, type StageOutput } from './contracts';
import { locateQuote } from './quotes';

export class PolicyError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

type Fault = { code: string; message: string };
const fault = (code: string, message: string): Fault => ({ code, message });

/** Identity and shape: is this artefact even addressable at this stage? */
function structuralFault(a: Artefact, all: Map<string, Artefact>, stage: number): Fault | null {
  if (all.has(a.id)) return fault('duplicate', 'The model returned duplicate artefact identifiers.');
  if (!STAGE_KINDS[stage]?.includes(a.kind)) return fault('contract', `An artefact of kind “${a.kind}” does not belong to this stage.`);
  // Name the field. "An artefact did not match its stage contract" told the owner
  // nothing and, worse, told the corrective round-trip nothing: on 2026-09-09 a
  // live graph stage failed three times because every node carried
  // `data.node` where the contract wants `data.entityId`, and the repair had no
  // way to know that.
  const shape = dataSchemas[a.kind].safeParse(a.data);
  if (!shape.success) return fault('contract', `An artefact did not match its stage contract (${a.kind} ${shape.error.issues.slice(0, 3).map((i) => `data.${i.path.join('.') || '?'}: ${i.message}`).join('; ')}).`);
  return null;
}

/**
 * Provenance and contract checks for one artefact against everything available.
 *
 * Mutates `a` on success for extracted facts: the page, section and text offsets
 * are taken from the passage rather than from the model, and `sourceQuote` is
 * rewritten to the document's own wording for the span it located.
 */
function semanticFault(a: Artefact, all: Map<string, Artefact>, stage: number): Fault | null {
  // An artefact that names its source and leaves `refs` empty is stating the same
  // link twice and recording it once. Fold it in rather than rejecting: measured
  // on a live run, THIRTEEN OF EIGHTEEN artefacts in one response were lost to
  // exactly this, which is also what was driving the corrective round-trips.
  if (a.sourceId && all.has(a.sourceId) && !a.refs.includes(a.sourceId)) a.refs = [a.sourceId, ...a.refs];
  if (a.kind !== 'passage' && !a.refs.length) return fault('provenance', 'An artefact has no supporting evidence links.');
  if (a.refs.some((id) => id === a.id || !all.has(id))) return fault('provenance', 'An artefact cites an unavailable source.');
  if (stage === 1 && ['claim', 'mechanism', 'actor'].includes(a.kind) && a.origin !== 'extracted_fact') return fault('extraction', 'The document inventory must distinguish literal extraction from assumptions.');
  if (a.kind === 'edge' && (!a.fromId || !a.toId || !all.has(a.fromId) || !all.has(a.toId) || !a.relation || !a.temporal)) return fault('graph', 'A graph assertion has invalid endpoints or provenance.');
  if (a.origin === 'extracted_fact' && a.kind !== 'passage') {
    const source = a.sourceId ? all.get(a.sourceId) : null;
    if (source?.kind !== 'passage' || !a.sourceQuote || !a.refs.includes(source.id)) return fault('span', 'An extracted assertion could not be located in the policy text.');
    // Line wrapping, hyphenation and smart punctuation are extraction artefacts,
    // not misquotation. A quote absent even after folding them is fabricated.
    const found = locateQuote(source.statement, a.sourceQuote);
    if (!found) return fault('span', 'An extracted assertion could not be located in the policy text.');
    a.sourceQuote = found.quote;
    a.page = source.page; a.section = source.section;
    a.startOffset = (source.startOffset ?? 0) + found.start;
    a.endOffset = (source.startOffset ?? 0) + found.end;
  }
  // URLs originate exclusively in trusted research adapter results, never model output.
  if (a.url && a.kind !== 'research_source') return fault('citation', 'Model-authored URLs are not accepted as evidence.');
  if (a.sourceId && !all.has(a.sourceId)) return fault('source', 'The source reference is unavailable.');
  const actorTargets = a.kind === 'model' ? a.data.players as string[] : a.kind === 'edge' ? [a.fromId, a.toId] : a.kind === 'profile' || a.kind === 'exploit' || a.kind === 'persona_link' ? [a.data.actorId] : [];
  if (actorTargets.some((id) => typeof id === 'string' && all.get(id)?.kind === 'actor' && !id.startsWith('s2_'))) return fault('canonical', 'Graph assertions, profiles and models must use resolved actor identifiers.');
  if (a.kind === 'assumption' && !a.refs.some((id) => ['actor', 'mechanism'].includes(all.get(id)?.kind ?? ''))) return fault('hypothesis', 'An assumption must link to an affected actor or mechanism.');
  /**
   * A cited assumption absent from `refs` is a bookkeeping slip, not a fabrication.
   *
   * `prune` has already run, so every identifier still in these arrays RESOLVES.
   * The artefact named the assumption, the assumption exists, and provenance is
   * exactly what a citation means — so fold it in, precisely as a finding's
   * `hypothesisIds` already are. What still fails is naming something that is not
   * an assumption at all, which is a contract violation rather than a slip.
   *
   * These were fatal. On the verification run of 2026-09-10 they discarded
   * **21 exploitation plays and 3 scenarios**, the single largest source of lost
   * work in that run: the playbook produced about 33 plays and kept 12. Every one
   * of the discarded plays named assumptions that resolved. It is the same
   * all-or-nothing failure the finding rule was fixed for in the first place,
   * wearing the same hat one stage earlier.
   */
  const citedAssumptions = a.kind === 'exploit' ? a.data.preconditions as string[]
    : a.kind === 'model' || a.kind === 'scenario' ? a.data.assumptions as string[]
    : null;
  if (citedAssumptions) {
    const wrongKind = citedAssumptions.filter((id) => all.get(id)?.kind !== 'assumption');
    if (wrongKind.length) return fault('hypothesis', a.kind === 'exploit'
      ? 'An exploitation play must depend on assumptions, not on other kinds of artefact.'
      : 'Interaction models and scenarios must depend on assumptions, not on other kinds of artefact.');
    for (const id of citedAssumptions) if (!a.refs.includes(id)) a.refs = [...a.refs, id];
  }
  if (a.origin === 'normative_judgement' && a.kind === 'research_source') return fault('source', 'A recommendation is not an external source.');
  if (a.kind === 'recommendation' && a.origin !== 'normative_judgement') return fault('recommendation', 'Redesign options must be labelled as normative recommendations.');
  if (a.kind === 'profile') {
    for (const value of Object.values(a.data)) {
      if (typeof value !== 'object' || !value || !('refs' in value)) continue;
      const f = value as { refs: string[]; confidence: number | null };
      if (f.refs.some((r) => !all.has(r)) || (!f.refs.length && f.confidence !== null)) return fault('profile', 'An incentive profile field lacks evidence or explicit uncertainty.');
    }
  }
  const referencedFields = ['actorId', 'entityId', 'questionId', 'sourceId', 'claimId', 'mechanismId', 'assumptionId', 'firstActor'];
  for (const field of referencedFields) {
    const value = a.data[field];
    if (typeof value === 'string' && !all.has(value)) return fault('reference', 'An artefact contains an invalid entity reference.');
  }
  for (const field of ['players', 'assumptions', 'resultIds', 'hypothesisIds', 'findingIds', 'candidates', 'mentions', 'dependencies', 'affectedOutcomes', 'targets', 'preconditions']) {
    const values = a.data[field];
    if (Array.isArray(values) && values.some((v) => typeof v !== 'string' || !all.has(v))) return fault('reference', 'An artefact contains an invalid relationship.');
  }
  return null;
}

/**
 * Checks that depend on the whole graph rather than one artefact's own fields.
 *
 * Mutates a finding on the way through: a cited identifier missing from `refs`
 * is folded in, and a hypothesis no cited result can reach is dropped. Both used
 * to be fatal, and between them they deleted the entire report in three
 * consecutive production runs — 14 of 15 findings and every recommendation
 * behind them, while the findings themselves were well formed and every
 * identifier resolved. That is the all-or-nothing failure this feature was
 * supposed to have stopped making, wearing a different hat.
 */
function relationalFault(a: Artefact, all: Map<string, Artefact>): Fault | null {
  if (!hasSource(a.id, all)) return fault('traceability', 'An artefact has no traceable path to policy text or external evidence.');
  if (a.kind === 'finding') {
    const results = a.data.resultIds as string[];
    let hypotheses = a.data.hypothesisIds as string[];
    if (!results.every((id) => (RESULT_KINDS as readonly string[]).includes(all.get(id)?.kind ?? '')) || !hypotheses.every((id) => all.get(id)?.kind === 'assumption')) return fault('traceability', 'A conclusion must cite a test or model and its hypotheses.');
    // A hypothesis none of the cited results reaches is an unsupported mention,
    // not a false conclusion. A `test` records its inputs as claims and evidence
    // rather than as assumptions, so ANY conclusion citing a test alongside an
    // assumption failed this outright — which is why the executive assessment and
    // the exploitation chapter, the two that span the most, died every time.
    const supported = hypotheses.filter((h) => results.some((r) => reaches(r, h, all)));
    if (!supported.length) return fault('traceability', 'No hypothesis this conclusion rests on is supported by the results it cites.');
    if (supported.length !== hypotheses.length) {
      a.data.hypothesisIds = supported;
      hypotheses = supported;
    }
    // A cited identifier absent from `refs` is a bookkeeping slip: the artefact
    // named it, it resolves, and provenance is exactly what the citation means.
    // Fold it in rather than discarding the conclusion.
    for (const id of [...results, ...hypotheses]) if (!a.refs.includes(id)) a.refs = [...a.refs, id];
  }
  return null;
}

/**
 * The strict gate. Every artefact must pass or the whole response is refused.
 *
 * Used as the final check on a stage's assembled output, and by the tests that
 * pin each individual rule. The RUNTIME path through a model response is
 * `triageOutput`, which applies exactly these rules per artefact instead.
 */
export function validateOutput(raw: unknown, stage: number, prior: Artefact[]): StageOutput {
  const parsed = stageOutputSchema.safeParse(raw);
  if (!parsed.success) throw new PolicyError('contract', 'The model returned an invalid structured result. Resume to retry.');
  const output = parsed.data;
  const all = new Map(prior.map((a) => [a.id, a]));
  for (const a of output.artefacts) {
    const f = structuralFault(a, all, stage);
    if (f) throw new PolicyError(f.code, f.message);
    all.set(a.id, a);
  }
  for (const a of output.artefacts) {
    const f = semanticFault(a, all, stage);
    if (f) throw new PolicyError(f.code, f.message);
  }
  for (const a of output.artefacts) {
    const f = relationalFault(a, all);
    if (f) throw new PolicyError(f.code, f.message);
  }
  return output;
}

export type Rejection = { id: string; kind: string; code: string; reason: string };
export type TriagedOutput = StageOutput & { rejected: Rejection[] };

/**
 * The lenient gate, and the one every live model response goes through.
 *
 * WHY. The strict gate is all-or-nothing: one bad artefact out of twenty-five
 * throws away the other twenty-four, the stage, and — after three attempts of the
 * identical prompt — the entire eleven-stage run. That is exactly how the first
 * production run died, six times over, on three different rules, while the
 * analysis it was rejecting was sound each time.
 *
 * Here a faulty artefact is quarantined and named, its dependants cascade out
 * with it, and what survives is kept. The stage's own coverage rules in
 * `pipeline.ts` still decide whether what survived is enough — so leniency about
 * individual artefacts never becomes leniency about the assessment.
 */
export function triageOutput(raw: unknown, stage: number, prior: Artefact[]): TriagedOutput {
  // Parsed WITHOUT the artefacts, then each artefact on its own. Parsing them as
  // one array of strict members put the all-or-nothing failure back a level: on
  // 2026-09-09 a live assessment lost a whole passage because one artefact of
  // eighteen left out a field that means nothing for its kind.
  const envelope = looseOutputSchema.safeParse(raw);
  if (!envelope.success) throw new PolicyError('contract', 'The model returned an invalid structured result. Resume to retry.');
  const malformed: Rejection[] = [];
  const artefacts: Artefact[] = [];
  for (const [index, candidate] of envelope.data.artefacts.entries()) {
    const one = artefactSchema.safeParse(candidate);
    if (one.success) { artefacts.push(one.data as Artefact); continue; }
    const where = one.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'artefact'}: ${i.message}`).join('; ');
    const named = candidate && typeof candidate === 'object' ? String((candidate as { id?: unknown }).id ?? `item ${index + 1}`) : `item ${index + 1}`;
    malformed.push({ id: named, kind: String((candidate as { kind?: unknown })?.kind ?? 'unknown'), code: 'contract', reason: `An artefact did not match the contract (${where}).` });
  }
  const warnings = (envelope.data.warnings ?? []).filter((w): w is string => typeof w === 'string').slice(0, 100);
  const triaged = triageArtefacts({ artefacts, warnings }, stage, prior);
  if (!malformed.length) return triaged;
  const names = malformed.slice(0, 6).map((r) => `${r.id} (${r.kind})`).join(', ');
  return {
    artefacts: triaged.artefacts,
    warnings: clampWarnings([...triaged.warnings, `${malformed.length} model output${malformed.length === 1 ? ' was' : 's were'} discarded and are not part of this assessment — ${malformed[0].reason} Affected: ${names}${malformed.length > 6 ? `, and ${malformed.length - 6} more` : ''}.`]),
    rejected: [...malformed, ...triaged.rejected],
  };
}

/**
 * The same triage over an output that is ALREADY typed — a stage's assembled
 * result rather than one model response.
 *
 * `stageOutputSchema` bounds a single response at 2,000 artefacts and 100
 * warnings. A stage is the union of every unit of its fan-out, so a hundred-page
 * document blows both caps with every model call having succeeded. Re-parsing
 * the aggregate through the single-response envelope turned that into
 * "The model returned an invalid structured result", which is neither true nor
 * actionable. The per-artefact rules are what matter here, so apply those.
 */
export function triageArtefacts(output: StageOutput, stage: number, prior: Artefact[]): TriagedOutput {
  const parsed = output;
  const priorIds = new Set(prior.map((a) => a.id));
  const rejected: Rejection[] = [];
  const drop = (a: Artefact, f: Fault) => { rejected.push({ id: a.id, kind: a.kind, code: f.code, reason: f.message }); };
  const pruned: string[] = [];
  const dropWarning = (a: Artefact) => (what: string) => pruned.push(`“${a.label}” lost ${what}.`);

  let kept: Artefact[] = [];
  const seen = new Set<string>();
  for (const a of parsed.artefacts) {
    // Echoing a supplied artefact back is a courtesy, not a contract breach:
    // drop the copy rather than the response.
    if (priorIds.has(a.id) || seen.has(a.id)) { drop(a, fault('duplicate', 'The model repeated an identifier that already exists; the repeat was discarded.')); continue; }
    seen.add(a.id);
    kept.push(a);
  }

  const structural: Artefact[] = [];
  const map = new Map(prior.map((a) => [a.id, a]));
  for (const a of kept) {
    const f = structuralFault(a, map, stage);
    if (f) { drop(a, f); continue; }
    map.set(a.id, a);
    structural.push(a);
  }
  kept = structural;

  // Identifiers the model invented are pruned, ONCE, against everything that got
  // this far — before the cascade, so an id dropped for cause still takes its
  // dependants with it while an id that never existed only costs the mention.
  // Measured on a live stage-1 sweep: fifteen of twenty-seven discarded groups
  // were an actor whose `mentions` held the words "landlords" and "tenants"
  // rather than the passages that mention them, or a claim citing a sibling by a
  // name it had made up.
  for (const a of kept) prune(a, map, dropWarning(a));

  // Dropping an artefact can invalidate whatever pointed at it, so settle.
  for (let pass = 0; pass < 6; pass++) {
    const all = new Map(prior.map((a) => [a.id, a]));
    for (const a of kept) all.set(a.id, a);
    const survivors = kept.filter((a) => {
      const f = semanticFault(a, all, stage) ?? relationalFault(a, all);
      if (f) { drop(a, f); return false; }
      return true;
    });
    if (survivors.length === kept.length) { kept = survivors; break; }
    kept = survivors;
  }

  const warnings = [...parsed.warnings];
  if (pruned.length) warnings.push(`${pruned.length} item${pruned.length === 1 ? '' : 's'} referred to something that is not in this assessment; the reference was dropped and the item kept. ${pruned.slice(0, 4).join(' ')}${pruned.length > 4 ? ` And ${pruned.length - 4} more.` : ''}`.slice(0, 1000));
  if (rejected.length) {
    const byCode = new Map<string, Rejection[]>();
    for (const r of rejected) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
    for (const [, group] of byCode) {
      const names = group.slice(0, 6).map((r) => `${r.id} (${r.kind})`).join(', ');
      warnings.push(`${group.length} model output${group.length === 1 ? ' was' : 's were'} discarded and are not part of this assessment — ${group[0].reason} Affected: ${names}${group.length > 6 ? `, and ${group.length - 6} more` : ''}.`.slice(0, 1000));
    }
  }
  return { artefacts: kept, warnings: clampWarnings(warnings), rejected };
}

/**
 * Warnings are shown to the reader and stored per stage, so a fan-out over a
 * hundred passages must not bury the page — or silently lose the tail, which is
 * what a bare `.slice()` does.
 */
export function clampWarnings(warnings: string[], limit = 60): string[] {
  if (warnings.length <= limit) return warnings;
  return [...warnings.slice(0, limit - 1), `And ${warnings.length - limit + 1} further warnings of the same kinds, not listed individually.`];
}

// Both traversals below share ONE visited set across the whole search. They used
// to copy it per edge — `new Set(seen)` — which turns reachability into full path
// enumeration: exponential in a dense provenance graph, and now run once per
// artefact per triage pass. Reachability does not care which path reached a node,
// so a shared set is both correct and linear.
const PRUNABLE = ['players', 'assumptions', 'resultIds', 'hypothesisIds', 'findingIds', 'candidates', 'mentions', 'dependencies', 'affectedOutcomes', 'targets', 'preconditions'];

/**
 * Drop identifiers that name nothing, keeping the artefact.
 *
 * `refs` keeps whatever resolves; the emptiness and traceability rules then
 * decide whether what remains supports the artefact at all. A `data` array is
 * only pruned if the kind's OWN schema still accepts the result — so a model
 * with no players, or a finding with no results, is still refused rather than
 * quietly reduced to nothing.
 */
function prune(a: Artefact, all: Map<string, Artefact>, note: (what: string) => void): void {
  const refs = a.refs.filter((id) => id !== a.id && all.has(id));
  if (refs.length !== a.refs.length) { note(`${a.refs.length - refs.length} unresolvable provenance link${a.refs.length - refs.length === 1 ? '' : 's'}`); a.refs = refs; }
  for (const field of PRUNABLE) {
    const values = a.data[field];
    if (!Array.isArray(values)) continue;
    const trimmed = values.filter((v) => typeof v === 'string' && all.has(v));
    if (trimmed.length === values.length) continue;
    const candidate = { ...a.data, [field]: trimmed };
    if (!dataSchemas[a.kind].safeParse(candidate).success) continue;
    note(`${values.length - trimmed.length} unresolvable entr${values.length - trimmed.length === 1 ? 'y' : 'ies'} in ${field}`);
    a.data = candidate;
  }
}

export function hasSource(id: string, all: Map<string, Artefact>, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const a = all.get(id);
  if (!a) return false;
  if (a.kind === 'passage' || a.kind === 'research_source') return true;
  return a.refs.some((r) => hasSource(r, all, seen));
}

export function reaches(from: string, to: string, all: Map<string, Artefact>, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return all.get(from)?.refs.some((id) => reaches(id, to, all, seen)) ?? false;
}
