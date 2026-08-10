import { buildSystemPrompt, buildIterationContext, type BuildPromptMode } from './prompt';
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
import { consumePendingDeliveries } from './workflow-deliveries';
import { buildAttachedWorkflowGrounding, buildDeliveriesBlock } from './workflow-grounding';

/**
 * Ask the tool bridge for its manifest exactly as the sandboxed agent will.
 *
 * Logs the outcome either way — a healthy build says how many tools it has, a
 * broken one says why it has none — and never throws: a missing bridge degrades
 * the build, it does not invalidate it. The agent still has its own file and
 * shell tools.
 */
async function preflightToolBridge(
  buildId: string,
  apiUrl: string,
  token: string,
  iterationId: string,
): Promise<void> {
  try {
    const res = await fetch(`${apiUrl}/api/jkai/tools/manifest`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await emitLog(
        buildId,
        'error',
        `Tool bridge unavailable — ${apiUrl}/api/jkai/tools/manifest returned ${res.status}. ` +
          `This iteration will run with NO site tools (no workflow_*, datastore_*, gmail_* …). ` +
          `A 401 usually means the route is not exempted in hooks.server.ts or JKAI_BRIDGE_SECRET ` +
          `differs between this process and the web app; a connection error usually means ` +
          `JKAI_API_URL is stale — this process reads it once at start, so restart the builder ` +
          `after editing .env.`,
        iterationId,
      );
      return;
    }
    const body = (await res.json().catch(() => null)) as { tools?: unknown[] } | null;
    await emitLog(
      buildId,
      'system',
      `Tool bridge OK — ${body?.tools?.length ?? 0} site tools available to the agent.`,
      iterationId,
    );
  } catch (err) {
    await emitLog(
      buildId,
      'error',
      `Tool bridge unreachable at ${apiUrl} (${(err as Error).message}). This iteration will run ` +
        `with NO site tools. JKAI_API_URL is read once at process start — restart the builder ` +
        `service after changing it.`,
      iterationId,
    );
  }
}

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

  // A git-target build is editing an existing repo and its deliverable is a
  // diff, not a preview server. It needs a different system prompt — see
  // REPO_SYSTEM_PROMPT in ./prompt for why the app-build one actively harms it.
  const gitTarget = (build as JkaiBuild & { gitTargetConfig?: { gateCommand?: string } | null })
    .gitTargetConfig;
  const isStudio = (build as JkaiBuild & { origin?: string }).origin === 'studio';
  const promptMode: BuildPromptMode = gitTarget ? 'repo' : isStudio ? 'studio' : 'app';

  // Verify-then-fix: the sandbox may have been removed since the last iteration
  // (admin action, image rebuild, crash). Re-verify every time.
  await ensureSandboxRunning();
  await ensureWorkspace(build.id);

  const assignedPort = await allocatePort(build.id);

  let systemPrompt = buildSystemPrompt(build.id, assignedPort, promptMode);
  const enforceDesign = (build as JkaiBuild & { enforceDesignSystem?: boolean }).enforceDesignSystem !== false;
  if (enforceDesign && !isStudio) {
    systemPrompt += `\n\n--- Design System (REQUIRED) ---\nA read-only design-system reference is mounted at \`./design-system/\` (relative to your workdir). BEFORE writing any HTML, CSS, or Svelte:\n1. Read \`./design-system/README.md\`.\n2. Read \`./design-system/components.md\` and \`./design-system/examples/page.svelte\`.\n3. Import \`./design-system/tokens.css\` (or copy its \`:root\` block) at the root of your stylesheet.\n4. Use the documented classes (\`.nm-sec\`, \`.nm-text-input\`, \`.nm-save-btn\`, \`.row-link\`, \`.status-dot\`, \`.kicker\`, \`.page-hdr\`).\n5. Never hard-code hex colours or font names. Always go through \`var(--…)\`.\nA post-iteration linter will reject this iteration on violations and feed the findings into the next iteration.`;
  }
  if (systemPromptSuffix) systemPrompt = `${systemPrompt}\n\n${systemPromptSuffix}`;

  // Sync design assets + jkai-tools extension into the sandbox before each run.
  // Updates land here so the agent always sees the latest tokens.
  const skillDirs: string[] = [];
  const extensions: string[] = [];
  const extraEnv: Record<string, string> = {};
  if (isStudio) {
    try {
      const { syncExplainerKit } = await import('./sandbox');
      const kitPath = await syncExplainerKit(build.id);
      skillDirs.push(kitPath);
    } catch (err) {
      // Loud, not silent. A studio build with no kit will invent its own
      // visual language, fail the visual gate, and burn iterations finding out.
      await emitLog(
        build.id,
        'error',
        `Explainer kit sync FAILED — this build will not have the kit: ${(err as Error).message}`,
        iteration.id,
      );
    }
  } else if (enforceDesign) {
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
    // host.docker.internal only resolves inside the (now-retired) docker
    // sandbox. Host mode talks to the local SvelteKit web app on loopback.
    const HOST_DEFAULT = process.env.JKAI_BUILDS_HOSTMODE === '1'
      ? 'http://127.0.0.1:4173'
      : 'http://host.docker.internal:5173';
    extraEnv.JKAI_API_URL = process.env.JKAI_API_URL ?? HOST_DEFAULT;
    extraEnv.JKAI_BRIDGE_TOKEN = signBridgeToken(build.id);

    // Preflight the bridge from the orchestrator, before spending a single
    // model token. The extension itself only writes a line to stderr when the
    // manifest fetch fails, and the agent then runs with ZERO site tools while
    // appearing perfectly healthy — builds #125/#126 each burned ~1.5M tokens
    // that way before dying of something unrelated (2026-08-07). A tool-less
    // build is worth knowing about at second zero, not at minute twenty.
    await preflightToolBridge(
      build.id,
      extraEnv.JKAI_API_URL,
      extraEnv.JKAI_BRIDGE_TOKEN,
      iteration.id,
    );
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

  // Build a structured codebase digest — file map + extracted signatures —
  // injected into iteration context so the agent skips the rediscovery
  // phase. listDevFiles returns rich entries (path, size, mtime); the
  // digest helper picks the most-recently-modified relevant files,
  // summarises each, and produces a markdown block under 8 KB.
  const { listDevFiles } = await import('./sandbox');
  const { buildCodebaseDigest } = await import('./codebase-digest');
  const devFiles = await listDevFiles(build.id).catch(() => []);
  const codebaseDigest = await buildCodebaseDigest(build.id, devFiles).catch(() => '');

  const contextMessages = buildIterationContext(
    build.prompt,
    prevIteration,
    fileList,
    projectPlan,
    iterationNumber,
    assignedPort,
    codebaseDigest,
    promptMode,
    gitTarget?.gateCommand ?? null,
    isStudio
      ? ((build as JkaiBuild & { chapterPlan?: Array<{ n: number; title: string; leverId: string; outcomeId: string }> }).chapterPlan ?? null)
      : null,
  );

  const attachedIds = (build as JkaiBuild & { attachedWorkflowIds?: string[] }).attachedWorkflowIds ?? [];
  const attachedGrounding = attachedIds.length > 0 ? await buildAttachedWorkflowGrounding(attachedIds) : '';
  if (attachedGrounding) systemPrompt = `${systemPrompt}\n\n${attachedGrounding}`;

  // Phase 6: re-inject pinned notes every iteration. The user's "always
  // remember this" directives — applied as hard constraints by the agent.
  const { listNotes, formatNotesForPrompt } = await import('./build-notes');
  const notes = await listNotes(build.id).catch(() => []);
  const notesBlock = formatNotesForPrompt(notes);
  if (notesBlock) systemPrompt = `${systemPrompt}\n\n${notesBlock}`;

  // Phase 5: drain queued user messages (typed mid-iteration via the
  // session WebSocket). They take precedence over earlier instructions
  // where they conflict, so they're appended last.
  const { drainPendingMessages, formatPendingForPrompt } = await import('./pending-messages');
  const pending = await drainPendingMessages(build.id).catch(() => []);
  const pendingBlock = formatPendingForPrompt(pending);
  if (pendingBlock) systemPrompt = `${systemPrompt}\n\n${pendingBlock}`;

  const deliveries = await consumePendingDeliveries(build.id, 10).catch(() => []);
  const deliveriesBlock = buildDeliveriesBlock(deliveries);

  const userPrompt = [deliveriesBlock, contextMessages.map((m) => m.content).join('\n\n')]
    .filter((s) => s.length > 0)
    .join('\n\n');

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
