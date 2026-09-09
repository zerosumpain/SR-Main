import { PATTERNS, SCENARIOS, type Artefact, type StageInput, type StageOutput } from './contracts';
import { PolicyError, validateOutput } from './validation';
import { modelApplicability } from './models';
import { preserveAmbiguity } from './entities';
import { runPolicyTests } from './tests';
import type { ModelCall } from './server/provider';
import type { Research } from './server/research';

export type PipelineDeps = { model: ModelCall; research: Research; signal: AbortSignal };
export async function executeStage(input: StageInput, deps: PipelineDeps): Promise<StageOutput> {
  const { stage } = input;
  const output: StageOutput = { artefacts: [], warnings: [] };
  const request = async (key: string, context: Artefact[]) => {
    deps.signal.throwIfAborted();
    const raw = await deps.model(stage, key, { ...input, artefacts: context, idPrefix: `s${stage}_${key}_`, targetActorId: stage === 4 ? key : null, targetPattern: stage === 7 ? key : null, targetScenario: stage === 9 ? key : null, modelLibrary: stage === 7 ? modelApplicability(input.artefacts) : undefined });
    const result = validateOutput(raw, stage, [...input.artefacts, ...output.artefacts]);
    output.artefacts.push(...result.artefacts); output.warnings.push(...result.warnings);
  };
  if (stage === 1) {
    for (const passage of input.artefacts.filter((a) => a.kind === 'passage')) await request(passage.id, [passage]);
  } else if (stage === 4) {
    for (const actor of input.artefacts.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'))) {
      const related = new Set([actor.id, ...actor.refs, ...input.artefacts.filter((a) => a.fromId === actor.id || a.toId === actor.id || a.refs.includes(actor.id)).flatMap((a) => [a.id, ...a.refs, a.fromId ?? '', a.toId ?? ''])]);
      const context = input.artefacts.filter((a) => related.has(a.id));
      await request(actor.id, [...context, ...(context.includes(actor) ? [] : [actor])]);
      const latest = output.artefacts.at(-1);
      if (latest?.kind !== 'profile' || latest.data.actorId !== actor.id) throw new PolicyError('coverage', 'A consequential actor has no incentive profile.');
    }
  } else if (stage === 7 || stage === 9) {
    const context = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    for (const key of stage === 7 ? PATTERNS : SCENARIOS) await request(key, context);
  } else if (stage === 8) {
    output.artefacts = runPolicyTests(input.artefacts);
  } else {
    // Full source text was inspected passage by passage. Later stages receive the
    // structured inventory plus source quotes, not a silently truncated paper.
    const context = input.artefacts.filter((a) => a.kind !== 'passage' && (stage !== 2 || a.kind === 'actor') && (stage < 3 || a.kind !== 'actor' || a.id.startsWith('s2_')));
    await request('main', context);
  }
  if (stage === 1 && !['claim', 'mechanism', 'assumption', 'actor'].every((k) => output.artefacts.some((a) => a.kind === k))) throw new PolicyError('coverage', 'The document did not yield the required claim, mechanism, assumption and actor inventory.');
  if (stage === 2) {
    output.artefacts = preserveAmbiguity(output.artefacts, input.artefacts);
    const mentions = input.artefacts.filter((a) => a.kind === 'actor');
    if (!mentions.every((m) => output.artefacts.some((a) => a.kind === 'actor' && (a.data.mentions as string[]).includes(m.id)))) throw new PolicyError('coverage', 'Entity resolution omitted source mentions.');
  }
  if (stage === 3 && !['node', 'edge'].every((k) => output.artefacts.some((a) => a.kind === k))) throw new PolicyError('coverage', 'The graph stage did not produce inspectable nodes and relationships.');
  if (stage === 5) {
    const questions = output.artefacts.filter((a) => a.kind === 'research_question');
    if (!questions.length || questions.length > 8 || questions.length !== output.artefacts.length) throw new PolicyError('coverage', 'Research planning must produce between one and eight targeted questions.');
    for (const question of questions) question.data.priority = priority(question);
    questions.sort((a, b) => priority(b) - priority(a));
    const researched = await deps.research(questions, deps.signal);
    output.artefacts.push(...researched.artefacts); output.warnings.push(...researched.warnings);
  }
  if (stage === 7 && !PATTERNS.every((p) => output.artefacts.some((a) => a.data.pattern === p))) throw new PolicyError('coverage', 'The interaction stage did not assess all eight model patterns.');
  if (stage === 9 && !SCENARIOS.every((s) => output.artefacts.some((a) => a.data.scenario === s))) throw new PolicyError('coverage', 'The scenario stage did not assess all eight conditions.');
  if (stage === 10) {
    const sections = ['executive_assessment', 'scope_methodology', 'objectives', 'actors', 'mechanisms', 'high_risk_assumptions', 'test_results', 'strategic_responses', 'scenarios', 'evidence_gaps', 'confidence_uncertainty', 'distribution', 'unresolved_questions'];
    if (!sections.every((s) => output.artefacts.some((a) => a.data.section === s)) || !output.artefacts.some((a) => a.kind === 'recommendation')) throw new PolicyError('coverage', 'The final assessment omitted required report sections or redesign options.');
  }
  if (!output.artefacts.length) throw new PolicyError('coverage', 'This stage produced no artefacts.');
  return validateOutput(output, stage, input.artefacts);
}
export function priority(a: Artefact): number {
  return Number(a.data.importance) * Number(a.data.uncertainty) * Number(a.data.consequence);
}
