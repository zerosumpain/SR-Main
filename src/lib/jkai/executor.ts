import { buildSystemPrompt, buildIterationContext } from './prompt';
import { listWorkspaceFiles, allocatePort } from './sandbox';
import { emitLog } from './log-emitter';
import type { ActionRecord } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { runPi } from './pi-runner';

// --- Section extraction (used by orchestrator for completion detection) ---

export function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// --- Iteration Result ---

export interface IterationResult {
  goals: string | null;
  plan: string | null;
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  evaluation: string | null;
  nextSteps: string | null;
  tokensUsed: number;
}

// --- Executor (pi-backed) ---

export async function executeIteration(
  build: JkaiBuild,
  iteration: JkaiIteration,
  prevIteration: JkaiIteration | null,
  projectPlan: string | null,
  iterationNumber: number,
  isStopped: () => boolean,
): Promise<IterationResult> {
  const workdir = `/home/jkai/workspace/${build.id}/dev`;

  // Assign the build its own serving port up-front so the agent knows which
  // port its serve.json should use. The orchestrator also enforces this later.
  const assignedPort = await allocatePort(build.id);

  const systemPrompt = buildSystemPrompt(build.id, assignedPort);
  const fileList = await listWorkspaceFiles(build.id);
  const contextMessages = buildIterationContext(
    build.prompt,
    prevIteration,
    fileList,
    projectPlan,
    iterationNumber,
    assignedPort,
  );
  const userPrompt = contextMessages.map((m) => m.content).join('\n\n');

  await emitLog(
    build.id,
    'system',
    `Iteration #${iterationNumber} — assigned port ${assignedPort}, workdir ${workdir}`,
    iteration.id,
  );

  const result = await runPi({
    build,
    iteration,
    workdir,
    systemPrompt,
    userPrompt,
    isStopped,
  });

  // Derive goals/plan/evaluation/nextSteps from pi's final assistant text.
  // Pi uses native tools so we no longer parse code blocks from markdown,
  // but we still ask the agent to close with structured ## Evaluation / ## Next Steps.
  const tailText = result.finalAssistantText || '';
  const goals = extractSection(tailText, 'Goals') ?? (tailText ? tailText.split('\n').slice(0, 4).join('\n') : null);
  const plan = extractSection(tailText, 'Plan') ?? null;
  let evaluation = extractSection(tailText, 'Evaluation');
  let nextSteps = extractSection(tailText, 'Next Steps');

  if (!evaluation) {
    evaluation =
      result.errorMessage
        ? `Iteration ended with error: ${result.errorMessage}`
        : `Iteration finished. Pi executed ${result.actions.length} tool calls. No structured evaluation produced — consider lowering iteration scope or checking the agent's final message.`;
  }
  if (!nextSteps) {
    nextSteps = 'Continue from where this iteration left off.';
  }

  return {
    goals,
    plan,
    actions: result.actions,
    messages: result.messages,
    evaluation,
    nextSteps,
    tokensUsed: result.tokensUsed,
  };
}
