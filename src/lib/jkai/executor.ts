import { buildSystemPrompt, buildIterationContext } from './prompt';
import {
  listWorkspaceFiles,
  allocatePort,
  ensureSandboxRunning,
  ensureWorkspace,
  syncDesignAssets,
  syncJkaiExtension,
} from './sandbox';
import { signBridgeToken } from './tool-bridge';
import { emitLog } from './log-emitter';
import type { ActionRecord, FailureEnvelope } from './types';
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
  failure: FailureEnvelope | null;
}

// --- Executor (pi-backed) ---

export async function executeIteration(
  build: JkaiBuild,
  iteration: JkaiIteration,
  prevIteration: JkaiIteration | null,
  projectPlan: string | null,
  iterationNumber: number,
  isStopped: () => boolean,
  systemPromptSuffix?: string,
  deadlineRef?: { current: number },
): Promise<IterationResult> {
  const workdir = `/home/jkai/workspace/${build.id}/dev`;

  // Verify-then-fix: the sandbox may have been removed since the last iteration
  // (admin action, image rebuild, crash). Re-verify every time.
  await ensureSandboxRunning();
  await ensureWorkspace(build.id);

  const assignedPort = await allocatePort(build.id);

  let systemPrompt = buildSystemPrompt(build.id, assignedPort);
  const enforceDesign = (build as JkaiBuild & { enforceDesignSystem?: boolean }).enforceDesignSystem !== false;
  if (enforceDesign) {
    systemPrompt += `\n\n--- Design System (REQUIRED) ---\nA read-only design-system reference is mounted at \`./design-system/\` (relative to your workdir). BEFORE writing any HTML, CSS, or Svelte:\n1. Read \`./design-system/README.md\`.\n2. Read \`./design-system/components.md\` and \`./design-system/examples/page.svelte\`.\n3. Import \`./design-system/tokens.css\` (or copy its \`:root\` block) at the root of your stylesheet.\n4. Use the documented classes (\`.nm-sec\`, \`.nm-text-input\`, \`.nm-save-btn\`, \`.row-link\`, \`.status-dot\`, \`.kicker\`, \`.page-hdr\`).\n5. Never hard-code hex colours or font names. Always go through \`var(--…)\`.\nA post-iteration linter will reject this iteration on violations and feed the findings into the next iteration.`;
  }
  if (systemPromptSuffix) systemPrompt = `${systemPrompt}\n\n${systemPromptSuffix}`;

  // Sync design assets + jkai-tools extension into the sandbox before each run.
  // Updates land here so the agent always sees the latest tokens.
  const skillDirs: string[] = [];
  const extensions: string[] = [];
  const extraEnv: Record<string, string> = {};
  if (enforceDesign) {
    try {
      const dsPath = await syncDesignAssets(build.id);
      skillDirs.push(dsPath);
    } catch (err) {
      await emitLog(
        build.id,
        'system',
        `Design assets sync failed (continuing without): ${(err as Error).message}`,
        iteration.id,
      );
    }
  }
  try {
    const extPath = await syncJkaiExtension(build.id);
    extensions.push(extPath);
    extraEnv.JKAI_API_URL = process.env.JKAI_API_URL ?? 'http://host.docker.internal:5173';
    extraEnv.JKAI_BRIDGE_TOKEN = signBridgeToken(build.id);
  } catch (err) {
    await emitLog(
      build.id,
      'system',
      `JKAI tools extension sync failed (continuing without): ${(err as Error).message}`,
      iteration.id,
    );
  }
  const thinkingLevel = (build as JkaiBuild & { thinkingLevel?: string }).thinkingLevel || undefined;

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
    deadlineRef,
    extensions,
    skillDirs,
    thinkingLevel,
    extraEnv,
  });

  const tailText = result.finalAssistantText || '';
  const goals = extractSection(tailText, 'Goals') ?? (tailText ? tailText.split('\n').slice(0, 4).join('\n') : null);
  const plan = extractSection(tailText, 'Plan') ?? null;
  let evaluation = extractSection(tailText, 'Evaluation');
  let nextSteps = extractSection(tailText, 'Next Steps');

  // Classify "empty output": pi finished without failure, but produced no tool
  // calls. Pi-runner can't distinguish this from a legitimate no-op turn, so
  // the executor owns the classification.
  let failure = result.failure;
  if (!failure && result.actions.length === 0) {
    failure = {
      kind: 'empty_output',
      message: 'Pi finished without making any tool calls.',
      attempts: 1,
    };
  }

  if (!evaluation) {
    evaluation =
      result.errorMessage
        ? `Iteration ended with error: ${result.errorMessage}`
        : failure?.kind === 'empty_output'
        ? `Pi produced no tool calls this turn (${failure.message}).`
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
    failure,
  };
}
