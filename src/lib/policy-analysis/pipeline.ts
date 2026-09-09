import { DEPTH_LIMITS, PATTERNS, REPORT_SECTIONS, SCENARIOS, SYNTHESIS_STAGE, type Artefact, type StageInput, type StageOutput } from './contracts';
import { scoreExploits } from './exposure';
import { clampWarnings, PolicyError, triageArtefacts, triageOutput } from './validation';
import { modelApplicability } from './models';
import { crossIdentityHints, preserveAmbiguity } from './entities';
import { runPolicyTests } from './tests';
import type { ModelCall } from './server/provider';
import type { Research } from './server/research';

/** Compact summaries of this reader's OTHER completed assessments, for stage 11. */
export type Neighbour = { id: string; title: string; policyArea: string | null; jurisdiction: string | null; completedAt: string | null; artefacts: { id: string; kind: string; label: string; statement: string; entityType?: string; aliases?: string[] }[] };
export type Neighbours = () => Promise<Neighbour[]>;
export type PipelineDeps = { model: ModelCall; research: Research; signal: AbortSignal; neighbours?: Neighbours };

/**
 * How many actors get an exploitation pass. Every resolved actor with a profile
 * is a candidate; the ones with the most connections in the policy graph go
 * first, because an actor nothing depends on has little to exploit. The rest are
 * named in a warning rather than dropped silently. A deep run takes more.
 */

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

export async function executeStage(input: StageInput, deps: PipelineDeps): Promise<StageOutput> {
  const { stage } = input;
  const limits = DEPTH_LIMITS[input.depth ?? 'standard'];
  const output: StageOutput = { artefacts: [], warnings: [] };
  let consecutive = 0;
  let lastFault: PolicyError | null = null;

  // Identifiers are capped at 100 characters, and a fan-out key can be a resolved
  // actor id that is nearly that long on its own. The prefix is therefore a short
  // sequence number, stable because every fan-out below iterates in sorted order.
  let seq = 0;
  const request = async (key: string, context: Artefact[], extra: Record<string, unknown> = {}) => {
    deps.signal.throwIfAborted();
    const slot = key === 'main' ? 'main' : String(seq++);
    const raw = await deps.model(stage, key, { ...input, artefacts: context, idPrefix: `s${stage}_${slot}_`, targetActorId: stage === 4 || stage === 10 ? key : null, targetPattern: stage === 7 ? key : null, targetScenario: stage === 9 ? key : null, modelLibrary: stage === 7 ? modelApplicability(input.artefacts) : undefined, ...extra });
    const result = triageOutput(raw, stage, [...input.artefacts, ...output.artefacts]);
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
      lastFault = err;
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
    output.artefacts = runPolicyTests(input.artefacts);
  } else if (stage === 10) {
    const profiles = input.artefacts.filter((a) => a.kind === 'profile');
    const ranked = rankActors(input.artefacts, profiles);
    if (ranked.length > limits.actors) output.warnings.push(`${ranked.length - limits.actors} of ${ranked.length} profiled actors were not red-teamed in this pass: ${ranked.slice(limits.actors).map((a) => a.label).join(', ')}. They are the least connected in the policy graph, not the least important. A deep run covers more of them.`);
    const base = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node', 'profile'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    for (const actor of ranked.slice(0, limits.actors)) {
      await attempt(actor.id, [...base, ...profiles.filter((p) => p.data.actorId === actor.id)], `Exploitation plays for ${actor.label}`, { protect: [actor.id, ...profiles.filter((p) => p.data.actorId === actor.id).map((p) => p.id)] });
    }
    scoreExploits(output.artefacts);
  } else if (stage === 11) {
    const neighbours = (await deps.neighbours?.()) ?? [];
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
    await request('main', context);
  }

  const pursue = async (questions: Artefact[], round: number) => {
    for (const question of questions) question.data.priority = Number(priority(question).toFixed(4));
    questions.sort((a, b) => priority(b) - priority(a));
    const researched = await deps.research(questions, deps.signal, limits.results);
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
    if (missing.length) throw new PolicyError(lastFault?.code ?? 'coverage', `The document did not yield the required claim, mechanism, assumption and actor inventory.${lastFault ? ` Last reason: ${lastFault.message}` : ''}`);
  }
  if (stage === 2) {
    output.artefacts = preserveAmbiguity(output.artefacts, input.artefacts);
    const mentions = input.artefacts.filter((a) => a.kind === 'actor');
    if (!mentions.every((m) => output.artefacts.some((a) => a.kind === 'actor' && (a.data.mentions as string[]).includes(m.id)))) throw new PolicyError('coverage', 'Entity resolution omitted source mentions.');
  }
  if (stage === 3 && kinds('node', 'edge').length) throw new PolicyError('coverage', 'The graph stage did not produce inspectable nodes and relationships.');
  if (stage === 4 && !output.artefacts.some((a) => a.kind === 'profile')) throw new PolicyError(lastFault?.code ?? 'coverage', `No actor could be profiled, so there are no incentives to reason about.${lastFault ? ` Last reason: ${lastFault.message}` : ''}`);
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
  if (stage === 7) requireMajority(output, PATTERNS, (a) => String(a.data.pattern), 'interaction model', lastFault);
  if (stage === 9) requireMajority(output, SCENARIOS, (a) => String(a.data.scenario), 'scenario', lastFault);
  if (stage === 10 && !output.artefacts.some((a) => a.kind === 'exploit')) throw new PolicyError(lastFault?.code ?? 'coverage', `No actor could be red-teamed, so the assessment has no exploitation playbook.${lastFault ? ` Last reason: ${lastFault.message}` : ''}`);
  if (stage === SYNTHESIS_STAGE) {
    // A missing chapter is a gap the reader should see named, not a reason to
    // throw away a whole assessment. Only the headline, the exploitation
    // chapter and the redesign options are load-bearing.
    const missing = REPORT_SECTIONS.filter((section) => !output.artefacts.some((a) => a.data.section === section));
    const core = missing.filter((m) => (['executive_assessment', 'high_risk_assumptions', 'exploitation'] as string[]).includes(m));
    if (core.length || !output.artefacts.some((a) => a.kind === 'recommendation')) throw new PolicyError('coverage', `The final assessment omitted ${core.length ? core.join(', ').replaceAll('_', ' ') : 'its redesign options'}.`);
    if (missing.length) output.warnings.push(`The final assessment has no ${missing.map((m) => m.replaceAll('_', ' ')).join(', ')} section. Read it as incomplete on those grounds.`);
  }
  // Stage 11 is the one stage that may legitimately produce nothing: a reader
  // with a single policy has no cross-policy exposure, and saying so is the answer.
  if (!output.artefacts.length && stage !== 11) throw new PolicyError(lastFault?.code ?? 'coverage', `This stage produced no artefacts.${lastFault ? ` Last reason: ${lastFault.message}` : ''}`);

  const final = triageArtefacts(output, stage, input.artefacts);
  return { artefacts: final.artefacts, warnings: clampWarnings(final.warnings) };
}

/**
 * A fixed library is only a guarantee if most of it actually ran. Without a strict
 * majority the stage has not done its job; with one, the absences are named in the
 * assessment and the run continues as `completed_with_gaps`.
 */
function requireMajority(output: StageOutput, library: readonly string[], of: (a: Artefact) => string, noun: string, lastFault: PolicyError | null) {
  const covered = new Set(output.artefacts.map(of));
  const missing = library.filter((key) => !covered.has(key));
  const covered_ = library.length - missing.length;
  if (covered_ * 2 <= library.length) throw new PolicyError(lastFault?.code ?? 'coverage', `Only ${covered_} of ${library.length} ${noun}s could be assessed.${lastFault ? ` Last reason: ${lastFault.message}` : ''}`);
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
