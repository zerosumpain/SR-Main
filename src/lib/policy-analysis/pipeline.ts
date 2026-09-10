import { DEPTH_LIMITS, PATTERNS, REPORT_SECTIONS, RESULT_KINDS, SCENARIOS, SYNTHESIS_STAGE, type Artefact, type StageInput, type StageOutput } from './contracts';
import { scoreExploits } from './exposure';
import { clampWarnings, PolicyError, triageArtefacts, triageOutput } from './validation';
import { modelApplicability } from './models';
import { crossIdentityHints, preserveAmbiguity } from './entities';
import { runPolicyTests } from './tests';
import { documentShingles, quotesDocument } from './query-guard';
import type { ModelCall } from './server/provider';
import type { Research } from './server/research';

/** Compact summaries of this reader's OTHER completed assessments, for stage 11. */
export type Neighbour = { id: string; title: string; policyArea: string | null; jurisdiction: string | null; completedAt: string | null; artefacts: { id: string; kind: string; label: string; statement: string; entityType?: string; aliases?: string[] }[] };
export type Neighbours = () => Promise<Neighbour[]>;
export type PipelineDeps = { model: ModelCall; research: Research; signal: AbortSignal; neighbours?: Neighbours };

/**
 * Stages that fan out over a list — one call per passage, actor, pattern or
 * scenario — no longer let a single bad call end the stage.
 *
 * The first production run died this way: passage 1 of 20 succeeded, passage 10
 * failed, and the other eighteen were never attempted. A unit of fan-out that
 * fails is now recorded as a gap and the sweep continues; the coverage rules at
 * the bottom of `executeStage` decide whether what came back is an assessment or
 * a failure. `CONSECUTIVE_LIMIT` stops a dead provider burning through the whole
 * list to reach the same conclusion twenty calls later.
 */
const CONSECUTIVE_LIMIT = 3;

/** Ceilings on a stage's assembled output, which no envelope bounds. */
const MAX_STAGE_ARTEFACTS = 4000;
const MAX_REFS = 200;

export async function executeStage(input: StageInput, deps: PipelineDeps): Promise<StageOutput & { rejected: number }> {
  const { stage } = input;
  const limits = DEPTH_LIMITS[input.depth ?? 'standard'];
  const output: StageOutput = { artefacts: [], warnings: [] };
  let consecutive = 0;
  let rejected = 0;
  // A holder, not a bare `let`: control-flow narrowing pins a `let` initialised
  // to null at `null` for the outer scope, so every read after the closure that
  // assigns it types as `never`.
  const fault: { last: PolicyError | null } = { last: null };

  // Identifiers are capped at 100 characters, and a fan-out key can be a resolved
  // actor id that is nearly that long on its own. The prefix is therefore a short
  // sequence number, stable because every fan-out below iterates in sorted order.
  let seq = 0;
  const request = async (key: string, context: Artefact[], extra: Record<string, unknown> = {}) => {
    deps.signal.throwIfAborted();
    const slot = key === 'main' ? 'main' : String(seq++).padStart(3, '0');
    const raw = await deps.model(stage, key, { ...input, artefacts: context, idPrefix: `s${stage}_${slot}_`, targetActorId: stage === 4 || stage === 10 ? key : null, targetPattern: stage === 7 ? key : null, targetScenario: stage === 9 ? key : null, modelLibrary: stage === 7 ? modelApplicability(input.artefacts) : undefined, ...extra });
    const result = triageOutput(raw, stage, [...input.artefacts, ...output.artefacts]);
    // Retrieved sources are minted by the retrieval adapter and nowhere else. The
    // kind is permitted at this stage so the server's own rows validate, which
    // would otherwise let a model hand back a source — and a URL — of its own.
    rejected += result.rejected.length;
    const authored = result.artefacts.filter((a) => a.kind === 'research_source');
    if (authored.length) {
      result.artefacts = result.artefacts.filter((a) => a.kind !== 'research_source');
      result.warnings.push(`${authored.length} model-authored source${authored.length === 1 ? '' : 's'} were discarded: evidence comes from retrieval, never from the model.`);
    }
    output.artefacts.push(...result.artefacts); output.warnings.push(...result.warnings);
    return result;
  };

  /** `request`, but a failure becomes a recorded gap instead of a dead stage. */
  const attempt = async (key: string, context: Artefact[], describe: string, extra: Record<string, unknown> = {}) => {
    try {
      const result = await request(key, context, extra);
      consecutive = 0;
      return result;
    } catch (err) {
      deps.signal.throwIfAborted();
      if (!(err instanceof PolicyError)) throw err;
      fault.last = err;
      consecutive++;
      output.warnings.push(`${describe} could not be assessed: ${err.message} It is missing from this stage.`);
      if (consecutive >= CONSECUTIVE_LIMIT) throw new PolicyError(err.code, `${CONSECUTIVE_LIMIT} consecutive parts of this stage failed for the same reason. ${err.message}`);
      return null;
    }
  };

  if (stage === 1) {
    const passages = input.artefacts.filter((a) => a.kind === 'passage');
    for (const passage of passages) await attempt(passage.id, [passage], `Passage “${passage.label}”`, { protect: [passage.id] });
  } else if (stage === 4) {
    for (const actor of input.artefacts.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'))) {
      const related = new Set([actor.id, ...actor.refs, ...input.artefacts.filter((a) => a.fromId === actor.id || a.toId === actor.id || a.refs.includes(actor.id)).flatMap((a) => [a.id, ...a.refs, a.fromId ?? '', a.toId ?? ''])]);
      const context = input.artefacts.filter((a) => related.has(a.id));
      const result = await attempt(actor.id, [...context, ...(context.includes(actor) ? [] : [actor])], `The incentive profile for ${actor.label}`, { protect: [actor.id] });
      if (result && !result.artefacts.some((a) => a.kind === 'profile' && a.data.actorId === actor.id)) {
        output.warnings.push(`${actor.label} has no incentive profile in this assessment; its motivations were not modelled.`);
      }
    }
  } else if (stage === 7 || stage === 9) {
    const context = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    // `modelApplicability` counts the graph assertions that trigger each pattern
    // and the result was read only as prose. A pattern with no trigger at all is
    // a fact about the policy, worth saying in the assessment.
    if (stage === 7) {
      const unsupported = modelApplicability(input.artefacts).filter((p) => !p.triggerEvidence.length).map((p) => p.pattern.replaceAll('_', ' '));
      if (unsupported.length) output.warnings.push(`${unsupported.length} of ${PATTERNS.length} interaction patterns have no supporting relationship in the policy graph and were assessed on inference alone: ${unsupported.join(', ')}.`);
    }
    for (const key of stage === 7 ? PATTERNS : SCENARIOS) await attempt(key, context, `The ${key.replaceAll('_', ' ')} ${stage === 7 ? 'interaction model' : 'scenario'}`);
  } else if (stage === 6) {
    // One evidence pass per research question, so retrieved sources are read
    // against the question they answer rather than all at once. Both the depth
    // and the size of a single call improve; the shipped code sent everything in
    // one request and hit the context ceiling as soon as research succeeded.
    const inventory = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    for (const question of input.artefacts.filter((a) => a.kind === 'research_question')) {
      const sources = input.artefacts.filter((a) => a.kind === 'research_source' && a.data.questionId === question.id);
      if (!sources.length) continue;
      await attempt(question.id, [...inventory, question, ...sources], `Evidence for “${question.label}”`, { protect: [question.id, ...sources.map((a) => a.id)] });
    }
    await attempt('main', inventory, 'Evidence drawn from the policy document itself');
  } else if (stage === 8) {
    output.artefacts = runPolicyTests(input.artefacts, input.graphLoss ?? 0);
  } else if (stage === 10) {
    // Every resolved actor with a profile is a candidate for the red team, and
    // `limits.actors` bounds how many get one. The most connected go first —
    // an actor nothing depends on has little to exploit — and the rest are named
    // in a warning rather than dropped silently.
    const profiles = input.artefacts.filter((a) => a.kind === 'profile');
    const ranked = rankActors(input.artefacts, profiles);
    if (ranked.length > limits.actors) output.warnings.push(`${ranked.length - limits.actors} of ${ranked.length} profiled actors were not red-teamed in this pass: ${ranked.slice(limits.actors).map((a) => a.label).join(', ')}. They are the least connected in the policy graph, not the least important. A deep run covers more of them.`);
    const base = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node', 'profile'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    for (const actor of ranked.slice(0, limits.actors)) {
      await attempt(actor.id, [...base, ...profiles.filter((p) => p.data.actorId === actor.id)], `Exploitation plays for ${actor.label}`, { protect: [actor.id, ...profiles.filter((p) => p.data.actorId === actor.id).map((p) => p.id)] });
    }
    scoreExploits(output.artefacts);
  } else if (stage === 11) {
    // Failing to LOAD the comparison must not cost the assessment its stage; the
    // rest of this run is unaffected by whether the other papers could be read.
    let neighbours: Neighbour[] = [];
    try { neighbours = (await deps.neighbours?.()) ?? []; }
    catch { output.warnings.push('The other assessments on this account could not be read, so cross-policy exposure was not examined.'); }
    if (!neighbours.length) {
      output.warnings.push('No other completed policy assessment was available to compare, so cross-policy exposure could not be examined. Weaknesses that only appear when policies coexist are outside this assessment.');
    } else {
      const context = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
      const identity = crossIdentityHints(input.artefacts, neighbours);
      await attempt('main', context, `Cross-policy exposure against ${neighbours.length} other assessment${neighbours.length === 1 ? '' : 's'}`, { neighbours, identity });
      const known = new Set(neighbours.map((n) => n.id));
      const invented = output.artefacts.filter((a) => a.kind === 'cross_policy' && !known.has(String(a.data.otherAnalysisId)));
      if (invented.length) {
        output.artefacts = output.artefacts.filter((a) => !invented.includes(a));
        output.warnings.push(`${invented.length} cross-policy claim${invented.length === 1 ? '' : 's'} named an assessment that was not supplied and ${invented.length === 1 ? 'was' : 'were'} discarded.`);
      }
    }
  } else {
    // Full source text was inspected passage by passage. Later stages receive the
    // structured inventory plus source quotes, not a silently truncated paper.
    const context = input.artefacts.filter((a) => a.kind !== 'passage' && (stage !== 2 || a.kind === 'actor') && (stage < 3 || a.kind !== 'actor' || a.id.startsWith('s2_')));
    // A finding must cite a test, model, scenario, exploitation play or
    // cross-policy exposure, so synthesis pins every one of them into the call.
    // Without that the context budget shed the lot — they are the last things
    // produced and carry the lowest confidence — and the model, still required
    // to cite a result, invented identifiers for results it had never seen.
    const protect = stage === SYNTHESIS_STAGE ? context.filter((a) => (RESULT_KINDS as readonly string[]).includes(a.kind)).map((a) => a.id) : [];
    await request('main', context, protect.length ? { protect } : {});
  }

  const pursue = async (questions: Artefact[], round: number) => {
    for (const question of questions) question.data.priority = Number(priority(question).toFixed(4));
    questions.sort((a, b) => priority(b) - priority(a));
    // A query that reproduces the paper verbatim would put an unpublished policy
    // into a third party's query logs. The prompt asks for a bounded public
    // query; this is what enforces it.
    const corpus = documentShingles(input.artefacts);
    const safe = questions.filter((q) => !quotesDocument(String(q.data.searchStrategy ?? ''), corpus));
    if (safe.length < questions.length) output.warnings.push(`${questions.length - safe.length} research question${questions.length - safe.length === 1 ? ' was' : 's were'} not searched because the query quoted the policy document; the document is not sent to a search provider.`);
    if (!safe.length) return;
    const researched = await deps.research(safe, deps.signal, limits.results);
    output.artefacts.push(...researched.artefacts);
    output.warnings.push(...researched.warnings.map((w) => round > 1 ? `Enquiry round ${round}: ${w}` : w));
  };

  const kinds = (...wanted: string[]) => wanted.filter((k) => !output.artefacts.some((a) => a.kind === k));
  if (stage === 1) {
    // The model scores every assumption on importance, uncertainty and consequence.
    // Stamp the product so the research planner, the report's high-risk chapter and
    // the dashboard all rank by the same reproducible figure.
    for (const a of output.artefacts) if (a.kind === 'assumption') a.data.priority = Number(priority(a).toFixed(4));
    const missing = kinds('claim', 'mechanism', 'assumption', 'actor');
    if (missing.length) throw new PolicyError(fault.last?.code ?? 'coverage', `The document did not yield the required claim, mechanism, assumption and actor inventory.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
  }
  if (stage === 2) {
    // A real 20-page policy yields ~50 source mentions, and asking one call to
    // claim every last one of them is the all-or-nothing rule again: on
    // 2026-09-09 a live run reached this stage with 224 artefacts and died here.
    // So: name what was missed and ask for JUST those, twice, then require a
    // strict majority and record the rest as a gap the reader can see.
    const mentions = input.artefacts.filter((a) => a.kind === 'actor');
    const unclaimed = () => mentions.filter((m) => !output.artefacts.some((a) => a.kind === 'actor' && ((a.data.mentions as string[]) ?? []).includes(m.id)));
    for (let round = 1; round <= 2; round++) {
      const missed = unclaimed();
      if (!missed.length) break;
      await attempt(`unclaimed${round}`, [...input.artefacts.filter((a) => a.kind === 'actor'), ...output.artefacts.filter((a) => a.kind === 'actor')], `${missed.length} unresolved source mention${missed.length === 1 ? '' : 's'}`, { unclaimedMentions: missed.map((m) => ({ id: m.id, label: m.label })) });
    }
    output.artefacts = preserveAmbiguity(output.artefacts, input.artefacts);
    const missed = unclaimed();
    if (missed.length * 2 >= mentions.length) throw new PolicyError('coverage', `Entity resolution claimed only ${mentions.length - missed.length} of ${mentions.length} source mentions.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
    if (missed.length) output.warnings.push(`${missed.length} of ${mentions.length} source mentions were never resolved into a named body: ${missed.slice(0, 8).map((m) => m.label).join(', ')}${missed.length > 8 ? `, and ${missed.length - 8} more` : ''}. Those actors are absent from the graph, the profiles and the red team.`);
  }
  if (stage === 3) {
    if (kinds('node', 'edge').length) throw new PolicyError('coverage', 'The graph stage did not produce inspectable nodes and relationships.');
    // "One node and one edge survived" is not a graph. Every later structural
    // check reads this stage's output, so losing the majority of it here would be
    // laundered into confident-looking verdicts drawn from almost nothing.
    if (rejected > output.artefacts.length) throw new PolicyError('coverage', `More of the policy graph was discarded than kept (${rejected} discarded, ${output.artefacts.length} retained). The structural checks would have been drawn from a fragment.`);
  }
  if (stage === 4 && !output.artefacts.some((a) => a.kind === 'profile')) throw new PolicyError(fault.last?.code ?? 'coverage', `No actor could be profiled, so there are no incentives to reason about.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
  if (stage === 5) {
    const questions = output.artefacts.filter((a) => a.kind === 'research_question');
    if (!questions.length || questions.length > limits.questions || questions.length !== output.artefacts.length) throw new PolicyError('coverage', `Research planning must produce between one and ${limits.questions} targeted questions.`);
    await pursue(questions, 1);
    // Rounds beyond the first are the line of enquiry: each one is planned from
    // what the last one actually found, not from the policy document again. A
    // round that raises no new question ends the enquiry rather than padding it.
    for (let round = 2; round <= limits.rounds; round++) {
      const asked = output.artefacts.filter((a) => a.kind === 'research_question');
      const sources = output.artefacts.filter((a) => a.kind === 'research_source');
      const before = output.artefacts.length;
      const context = input.artefacts.filter((a) => a.kind !== 'passage' && (a.kind !== 'actor' || a.id.startsWith('s2_')));
      await attempt(`round${round}`, [...context, ...asked, ...sources], `Follow-up enquiry round ${round}`, { enquiryRound: round, remainingQuestions: limits.questions, protect: sources.map((a) => a.id) });
      const followUps = output.artefacts.slice(before).filter((a) => a.kind === 'research_question');
      if (!followUps.length) { output.warnings.push(`Enquiry round ${round} raised no further question, so the enquiry stopped there.`); break; }
      await pursue(followUps, round);
    }
  }
  if (stage === 7) requireMajority(output, PATTERNS, (a) => String(a.data.pattern), 'interaction model', fault.last);
  if (stage === 9) requireMajority(output, SCENARIOS, (a) => String(a.data.scenario), 'scenario', fault.last);
  if (stage === 10 && !output.artefacts.some((a) => a.kind === 'exploit')) throw new PolicyError(fault.last?.code ?? 'coverage', `No actor could be red-teamed, so the assessment has no exploitation playbook.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
  if (stage === SYNTHESIS_STAGE) {
    // A missing chapter is a gap the reader should see named, not a reason to
    // throw away a whole assessment. Only the headline, the exploitation
    // chapter and the redesign options are load-bearing.
    const missing = REPORT_SECTIONS.filter((section) => !output.artefacts.some((a) => a.data.section === section));
    const core = missing.filter((m) => (['executive_assessment', 'high_risk_assumptions', 'exploitation'] as string[]).includes(m));
    if (core.length || !output.artefacts.some((a) => a.kind === 'recommendation')) {
      // Naming the missing chapters describes the symptom. What a reader needs is
      // why they are missing, which is always the reason the findings themselves
      // were quarantined — and that reason is already recorded.
      throw new PolicyError('coverage', `The final assessment omitted ${core.length ? core.join(', ').replaceAll('_', ' ') : 'its redesign options'}.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
    }
    if (missing.length) output.warnings.push(`The final assessment has no ${missing.map((m) => m.replaceAll('_', ' ')).join(', ')} section. Read it as incomplete on those grounds.`);
  }
  // Stage 11 is the one stage that may legitimately produce nothing: a reader
  // with a single policy has no cross-policy exposure, and saying so is the answer.
  if (!output.artefacts.length && stage !== 11) throw new PolicyError(fault.last?.code ?? 'coverage', `This stage produced no artefacts.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);

  // Quarantining is what keeps a run alive, and it is also how a thin assessment
  // could pass as a complete one: a stage whose graph was half discarded still
  // satisfies its coverage rule, and the deterministic checks then read the
  // gutted graph. So say what was lost, in the assessment, in figures.
  const discarded = output.warnings.filter((w) => w.includes('discarded and are not part of this assessment')).length;
  if (discarded) output.warnings.unshift(`${discarded} group${discarded === 1 ? '' : 's'} of model output were discarded in this stage. What follows is drawn from what survived; treat structural checks over this stage's relationships as a floor, not a verdict.`);
  const final = triageArtefacts(output, stage, input.artefacts);
  rejected += final.rejected.length;
  // A single response is bounded by its envelope; the assembled stage was not,
  // and `policy_provenance` grows with the square of a runaway fan-out.
  const kept = final.artefacts.slice(0, MAX_STAGE_ARTEFACTS);
  const warnings = [...final.warnings];
  if (final.artefacts.length > kept.length) warnings.push(`This stage produced ${final.artefacts.length} items and only the first ${MAX_STAGE_ARTEFACTS} were kept. The assessment is incomplete for this stage.`);
  for (const a of kept) {
    if (a.refs.length <= MAX_REFS) continue;
    warnings.push(`“${a.label}” cited ${a.refs.length} sources; only the first ${MAX_REFS} are recorded.`);
    a.refs = a.refs.slice(0, MAX_REFS);
  }
  return { artefacts: kept, warnings: clampWarnings(warnings), rejected };
}

/**
 * A fixed library is only a guarantee if most of it actually ran. Without a strict
 * majority the stage has not done its job; with one, the absences are named in the
 * assessment and the run continues as `completed_with_gaps`.
 */
function requireMajority(output: StageOutput, library: readonly string[], of: (a: Artefact) => string, noun: string, last: PolicyError | null) {
  const covered = new Set(output.artefacts.map(of));
  const assessed = library.length - library.filter((key) => !covered.has(key)).length;
  const missing = library.filter((key) => !covered.has(key));
  if (assessed * 2 <= library.length) throw new PolicyError(last?.code ?? 'coverage', `Only ${assessed} of ${library.length} ${noun}s could be assessed.${last ? ` Last reason: ${last.message}` : ''}`);
  if (missing.length) output.warnings.push(`${missing.length} of ${library.length} ${noun}s were not assessed: ${missing.map((m) => m.replaceAll('_', ' ')).join(', ')}. Treat the assessment as incomplete on those grounds.`);
}

/**
 * Profiled actors, most connected first. Degree in the policy graph is a crude
 * proxy for how much of the policy runs through an actor, and it is the only
 * ordering available before the red team has run.
 */
function rankActors(all: Artefact[], profiles: Artefact[]): Artefact[] {
  const degree = new Map<string, number>();
  for (const edge of all) {
    if (edge.kind !== 'edge') continue;
    for (const end of [edge.fromId, edge.toId]) if (end) degree.set(end, (degree.get(end) ?? 0) + 1);
  }
  return profiles
    .map((p) => all.find((a) => a.kind === 'actor' && a.id === p.data.actorId))
    .filter((a): a is Artefact => !!a)
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));
}

export function priority(a: Artefact): number {
  return Number(a.data.importance) * Number(a.data.uncertainty) * Number(a.data.consequence);
}
