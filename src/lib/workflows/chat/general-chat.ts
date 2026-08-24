// src/lib/workflows/chat/general-chat.ts — full replacement

import { db } from '$lib/db';
import {
  homeAssistantConfig,
  jkaiMemories,
  orchestratorChats,
  workflows,
  workflowNodes,
  workflowEdges,
} from '$lib/db/schema';
import { eq, isNull, desc } from 'drizzle-orm';
import { getLLMClient } from '$lib/jkai/llm-client';
import { recordConversationUsage, parseUsage } from '$lib/server/models/usage';
import { resolveThinkingModel } from '$lib/server/models/settings';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
import { META_TOOL_DEFINITIONS, getToolsetDefinitions, buildSiteSystemPromptSection } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool, isRegisteredTool } from '$lib/workflows/site-tools/executor';
import { setJobPhase } from '$lib/workflows/chat/job-store';
import { handleJkaiHelp, handleCreateTool, handleListCustomTools, handleDeleteTool } from '$lib/workflows/site-tools/meta-tools';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';
import { notifySubscribers } from '$lib/workflows/chat/followup-queue';
import type { JobEvent } from '$lib/workflows/chat/job-store';
import { buildMultimodalContent, encodedSizeBytes } from '$lib/jkai/media/multimodal';
import { extractUrlsFromText, fetchUrlContent, isUrlFetchError } from '$lib/jkai/extract/url';
import type { JkaiAttachment } from '$lib/db/schema';
import type { HistoryMessage } from './conversation-history';
import { buildKnowledgeContext } from '$lib/jkai/intel/context';
import { createNote, processNote } from '$lib/jkai/intel/ingest';
import { summarizeToolResult, summarizeRunningTool } from './tool-summary';
import { extractReasoningDelta } from './reasoning-delta';
import { extractPlan, awaitPlanApproval, isReadOnlyPlan } from './plan-phase';
import { extractClarify, awaitClarifyAnswers } from './clarify-phase';
import { getModelCapabilities } from '$lib/server/models/capabilities';
import { renderSkillIndex } from '$lib/jkai/skills/registry';
import { compressHistory, renderCompressionSection } from './compress';

const MAX_HISTORY = 30;
const DEFAULT_TOOL_ROUNDS = 10;
const EXTENDED_TOOL_ROUNDS = 30;
const ABSOLUTE_TOOL_ROUNDS = 50;
// User phrases that flip a turn into "extended autonomy" — bumps the
// tool-call budget from DEFAULT to EXTENDED so long workflow builds don't
// run out mid-wiring. Match anywhere in the message, case-insensitive.
const EXTENDED_AUTONOMY_PHRASES = [
  /\b(?:keep going|carry on)\b.*\b(?:until|till)\b/i,
  /\bno need to (?:check ?in|stop|pause)\b/i,
  /\bdon'?t (?:check ?in|stop|pause)\b/i,
  /\b(?:until|till) it'?s? (?:done|finished|complete)\b/i,
  /\bgo all the way\b/i,
  /\bextended autonomy\b/i,
  /\b(?:autonomously|on your own) (?:until|for longer)\b/i,
];
function detectExtendedAutonomy(userMessage: string): boolean {
  return EXTENDED_AUTONOMY_PHRASES.some((re) => re.test(userMessage));
}

/**
 * Fire-and-forget "opening acknowledgement" call. Reasoning models like
 * GLM-5.x routinely sit silent for 10–20s before emitting either text or a
 * tool_call on the orchestrator's first round, so the user sees nothing but
 * a "Working…" spinner until tools start running. This kicks off a tiny
 * parallel call with no tools, no reasoning-heavy context, and a 60-token
 * cap to push a one-sentence "what I'm about to do" into the chat stream
 * within a couple of seconds. Persists as source=status_update so it
 * survives reload (same shape as the round-5 mid-task update).
 */
async function emitOpeningAck(opts: {
  userMessage: string;
  modelContext: ModelContext;
  conversationId: string | null | undefined;
  priceSnapshot: PriceSnapshot | null;
  signal?: AbortSignal;
}): Promise<void> {
  if (!opts.conversationId) return;
  try {
    const { client, model } = await getLLMClient(opts.modelContext);
    const resp = await client.chat.completions.create(
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are jkai, a personal assistant. The user just sent a message and you are about to look something up. Reply with EXACTLY ONE short conversational sentence (max 14 words) telling them what you are about to do. Examples: "Pulling the weather for Darlington and your home temperatures.", "Checking your calendar for today.", "Looking up the bin schedule." No greetings, no JSON, no preamble. Just the one sentence.',
          },
          { role: 'user', content: opts.userMessage.slice(0, 2000) },
        ],
        temperature: 0.4,
        // GLM-5.x deducts reasoning tokens from max_tokens; 80 was starving the
        // visible-output budget so the call returned empty content. 800 leaves
        // ~700 for reasoning + ~100 for the one-sentence reply.
        max_tokens: 800,
      },
      opts.signal ? { signal: opts.signal } : undefined,
    );
    const text = resp.choices?.[0]?.message?.content?.trim();
    if (!text) return;
    if (opts.signal?.aborted) return;

    await db.insert(orchestratorChats).values({
      conversationId: opts.conversationId,
      role: 'assistant',
      content: text,
      metadata: { source: 'status_update' },
    });
    notifySubscribers(opts.conversationId, {
      role: 'assistant',
      content: text,
      source: 'status_update',
    });
    if (resp.usage) {
      recordConversationUsage(
        opts.conversationId,
        parseUsage(resp.usage as any),
        opts.priceSnapshot,
      ).catch((e) => console.warn('[general-chat] opening-ack usage record failed:', e));
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') return;
    console.warn('[general-chat] opening ack failed:', err instanceof Error ? err.message : err);
  }
}

interface ToolProgress {
  tool: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

interface ChatOptions {
  workflowId?: string | null;
  conversationId?: string | null;
  jobId?: string | null;
  onProgress?: (text: string) => void;
  onToolProgress?: (step: ToolProgress) => void;
  onStreamEvent?: (event: JobEvent) => void;
  modelContext: ModelContext;
  priceSnapshot: PriceSnapshot | null;
  /** When false, skips injecting the intel knowledge graph into the system prompt. Defaults to true. */
  useIntelContext?: boolean;
  /**
   * Pre-built intel context to inject verbatim, overriding the global
   * buildKnowledgeContext() call. Non-empty string = use it. Empty string =
   * no intel section. null/undefined = fall back to useIntelContext.
   */
  intelContextOverride?: string | null;
  /** When set (>= 1) the call is running as a sub-agent; disables plan phase
      and nested agent_spawn to prevent runaway fan-out. */
  subagentDepth?: number;
  /** Optional persona/system-prompt prefix. When set, it is prepended to the
      system prompt so a named specialist agent (see delegate_to_agent) speaks
      and reasons in its own role. Mirrors the orchestrator's personalityPrompt. */
  personaPrompt?: string;
  /** Optional tool-name whitelist. When set, only these tool names may be
      executed via this chat. Tools outside the list are filtered from
      activeTools at assembly time and agent_spawn is disabled. */
  toolWhitelist?: string[];
  /** Override the tool-call round budget. Clamped to [1, ABSOLUTE_TOOL_ROUNDS].
      When unset, the budget is derived: DEFAULT_TOOL_ROUNDS, bumped to
      EXTENDED_TOOL_ROUNDS if the user message signals extended autonomy,
      and bumped further at plan-emission time when the plan has many
      steps (steps × 3, capped at ABSOLUTE_TOOL_ROUNDS). */
  maxRounds?: number;
}

const MEMORY_BUDGET = 4000; // max chars for memory section

async function buildMemorySection(): Promise<string> {
  let rows;
  try {
    rows = await db.select()
      .from(jkaiMemories)
      .where(isNull(jkaiMemories.supersededBy))
      .orderBy(desc(jkaiMemories.updatedAt));
  } catch (err) {
    console.warn('[general-chat] Failed to load memories:', err instanceof Error ? err.message : err);
    return '';
  }

  if (rows.length === 0) return '';

  // Group by category
  const grouped: Record<string, string[]> = {};
  let totalChars = 0;

  for (const row of rows) {
    if (totalChars + row.content.length > MEMORY_BUDGET) break;
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row.content);
    totalChars += row.content.length;
  }

  const sections = Object.entries(grouped).map(([cat, items]) => {
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    return `**${label}:**\n${items.map(i => `- ${i}`).join('\n')}`;
  });

  return `\n\n--- Memory ---\n${sections.join('\n\n')}`;
}

function maybeIngestAsNote(userMessage: string): void {
  const capturePatterns = [
    /^(?:remember|note|record|save|store)\s+(?:that|this|the following)/i,
    /^(?:fyi|for the record|for reference)/i,
    /^intel:/i,
  ];

  const isCapture = capturePatterns.some((p) => p.test(userMessage.trim()));
  if (!isCapture) return;

  createNote({
    rawContent: userMessage,
    source: 'web',
    format: 'text',
    metadata: { capturedFrom: 'chat' },
  }).then((noteId) => {
    processNote(noteId).catch((err) => {
      console.error(`[intel] Chat capture processing failed:`, err);
    });
    console.log(`[intel] Captured chat message as note ${noteId}`);
  }).catch((err) => {
    console.error('[intel] Chat capture failed:', err);
  });
}

interface RunToolContext {
  activeTools: Array<any>;
  activatedToolsets: Set<string>;
  haEntities: any[];
  onToolProgress?: (step: ToolProgress) => void;
  onProgress?: (text: string) => void;
  onStreamEvent?: (event: JobEvent) => void;
  conversationId?: string | null;
  parentJobId?: string | null;
  modelContext?: ModelContext;
  subagentDepth?: number;
  toolWhitelist?: string[];
}

async function runSingleToolCall(
  toolCall: any,
  ctx: RunToolContext,
): Promise<{ toolMessage: { role: 'tool'; tool_call_id: string; content: string } }> {
  const { activeTools, activatedToolsets, haEntities, onToolProgress, onProgress, onStreamEvent, conversationId } = ctx;
  const fnName: string = toolCall.function.name;
  let fnArgs: Record<string, unknown>;
  try {
    fnArgs = JSON.parse(toolCall.function.arguments);
  } catch {
    return {
      toolMessage: {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'Invalid JSON arguments' }),
      },
    };
  }

  const runningSummary = summarizeRunningTool(fnName, fnArgs);
  onToolProgress?.({ tool: fnName, toolCallId: toolCall.id, args: fnArgs, status: 'running' });
  onProgress?.(`${fnName}: running${runningSummary ? ` — ${runningSummary}` : ''}\n`);
  onStreamEvent?.({ type: 'tool_start', tool: fnName, args: fnArgs, toolCallId: toolCall.id, summary: runningSummary || undefined });

  let toolResult: any;

  if (fnName === 'activate_toolset') {
    const toolset = fnArgs.toolset as string;
    if (activatedToolsets.has(toolset)) {
      toolResult = { success: true, data: { toolset, status: 'already_active', message: `${toolset} tools are already loaded.` } };
    } else if (toolset === 'home') {
      if (haEntities.length > 0) {
        const defs = getToolsetDefinitions('home');
        activeTools.push(...defs);
        activatedToolsets.add('home');
        const { buildHASystemPromptSection } = await import('$lib/workflows/homeassistant/llm-tools');
        const entitySummary = buildHASystemPromptSection(haEntities);
        toolResult = {
          success: true,
          data: {
            toolset: 'home',
            status: 'activated',
            tools: defs.map((d) => d.function.name),
            entityContext: entitySummary,
          },
        };
      } else {
        toolResult = { success: false, error: 'Home Assistant is not configured — no entities available.' };
      }
    } else {
      const defs = getToolsetDefinitions(toolset);
      if (defs.length === 0) {
        toolResult = { success: false, error: `Unknown toolset: ${toolset}` };
      } else {
        activeTools.push(...defs);
        activatedToolsets.add(toolset);
        toolResult = {
          success: true,
          data: {
            toolset,
            status: 'activated',
            tools: defs.map((d) => d.function.name),
          },
        };
      }
    }
  } else if (fnName === 'jkai_help') {
    toolResult = handleJkaiHelp(fnArgs);
  } else if (fnName === 'create_tool') {
    toolResult = await handleCreateTool(fnArgs);
    if (toolResult.success) {
      const newToolName = fnArgs.name as string;
      const newToolset = fnArgs.toolset as string;
      const newDefs = getToolsetDefinitions(newToolset).filter((d) => d.function.name === newToolName);
      activeTools.push(...newDefs);
      activatedToolsets.add(newToolset);
    }
  } else if (fnName === 'list_custom_tools') {
    toolResult = await handleListCustomTools();
  } else if (fnName === 'delete_tool') {
    toolResult = await handleDeleteTool(fnArgs);
    if (toolResult.success) {
      const deletedName = fnArgs.name as string;
      const idx = activeTools.findIndex((t: any) => t?.function?.name === deletedName);
      if (idx >= 0) activeTools.splice(idx, 1);
    }
  } else if (fnName === 'agent_spawn') {
    const depth = ctx.subagentDepth ?? 0;
    if (depth >= 1) {
      toolResult = { error: 'Sub-agents cannot spawn further sub-agents.' };
    } else if (!ctx.parentJobId || !ctx.modelContext) {
      toolResult = { error: 'agent_spawn requires a job context.' };
    } else if (ctx.toolWhitelist && !ctx.toolWhitelist.includes('agent_spawn')) {
      toolResult = { error: 'agent_spawn is not in the current tool whitelist.' };
    } else {
      try {
        const { runSubAgent } = await import('./sub-agent');
        const agentArgs = fnArgs as unknown as { task: string; tools?: string[] };
        const out = await runSubAgent(ctx.parentJobId, agentArgs, ctx.modelContext);
        toolResult = { success: true, data: out };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResult = { success: false, error: msg };
      }
    }
  } else if (isRegisteredTool(fnName)) {
    const { isDestructive, describeDestructiveAction, requireConfirmation } = await import('./confirmation-gate');
    // Build a tool-execution context so long-running tools can emit
    // user-visible progress (e.g. "Generating workflow nodes…"). The emit
    // callback publishes a `status` event onto the job's SSE stream, which
    // also resets the idle watchdog and the heartbeat ticker's currentStep.
    const jobId = ctx.parentJobId;
    const toolCtx = jobId
      ? {
          jobId,
          conversationId: conversationId ?? undefined,
          emit: (text: string) => {
            const trimmed = text.trim().slice(0, 200);
            if (!trimmed) return;
            setJobPhase(jobId, 'tool_running', `${fnName}: ${trimmed}`);
            onStreamEvent?.({ type: 'status', text: trimmed });
          },
        }
      : (conversationId ? { conversationId, emit: () => {} } : undefined);
    if (jobId) setJobPhase(jobId, 'tool_running', runningSummary || fnName);
    if (jobId && isDestructive(fnName)) {
      const prompt = describeDestructiveAction(fnName, fnArgs);
      const approved = await requireConfirmation(jobId, prompt, fnArgs, { destructive: true });
      if (!approved) {
        toolResult = { success: false, error: 'User declined the action.' };
      } else {
        toolResult = await executeSiteTool(fnName, fnArgs, toolCtx);
      }
    } else {
      toolResult = await executeSiteTool(fnName, fnArgs, toolCtx);
    }
    if (jobId) setJobPhase(jobId, 'waiting_llm', 'Drafting reply…');
  } else {
    toolResult = { error: `Unknown function: ${fnName}` };
  }

  // Auto-register a perpetual heartbeat watcher for any tool that declares
  // producesLongRunningTask. Generic, no per-tool special-casing in this
  // file — adding new long-running task families means declaring metadata
  // on the tool and adding a state-provider entry, not editing here.
  if (conversationId && toolResult?.success) {
    try {
      const { getTool } = await import('$lib/workflows/site-tools/registry');
      const def = getTool(fnName);
      if (def?.producesLongRunningTask) {
        const { autoRegisterFromToolResult } = await import('$lib/heartbeat/auto-register');
        const outcome = await autoRegisterFromToolResult({
          conversationId,
          toolName: fnName,
          produces: def.producesLongRunningTask,
          resultData: toolResult.data,
        });
        if (!outcome.registered) {
          console.warn(`[heartbeat-auto] skipped ${fnName}: ${outcome.reason}`);
        }
      }
    } catch (err) {
      console.error('[heartbeat-auto] auto-register threw:', err instanceof Error ? err.message : err);
    }
  }

  // Truncate result for progress display (keep full for LLM context)
  const progressResultStr = JSON.stringify(toolResult);
  const progressResult = progressResultStr.length > 2000
    ? { _truncated: true, preview: progressResultStr.slice(0, 2000) + '...' }
    : toolResult;
  const status: 'done' | 'error' = toolResult?.error ? 'error' : 'done';
  onToolProgress?.({ tool: fnName, toolCallId: toolCall.id, args: fnArgs, result: progressResult, status });
  onProgress?.(`${fnName}: done\n`);
  onStreamEvent?.({
    type: 'tool_result',
    tool: fnName,
    result: progressResult,
    status,
    toolCallId: toolCall.id,
    summary: summarizeToolResult({ tool: fnName, toolCallId: toolCall.id, args: fnArgs, result: progressResult, status }),
  });

  // Truncate large tool results to avoid overwhelming the LLM context.
  // 32KB strikes a balance: workflow_inspect / workflow_list_node_types /
  // file_read are typically 10-25KB and need to be seen whole; truly
  // pathological results still get clipped.
  let resultStr = JSON.stringify(toolResult);
  if (resultStr.length > 32000) {
    resultStr = resultStr.slice(0, 32000) + '... [truncated — result too large for chat context]';
  }
  return {
    toolMessage: {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: resultStr,
    },
  };
}

/**
 * When chat is running inside a canvas (i.e. options.workflowId is set),
 * tell the model exactly which workflow it's in and what's already there,
 * so the workflow_* tools target THIS canvas rather than spawning a
 * parallel one via workflow_create.
 */
async function buildCanvasContextSection(
  workflowId?: string | null,
): Promise<string> {
  if (!workflowId) return '';
  try {
    const [wf] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);
    if (!wf) return '';
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    const edges = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId));
    const slug = wf.name.startsWith('canvas:') ? wf.name.slice('canvas:'.length) : null;
    const hasTrigger = nodes.some((n) => n.type === 'trigger');
    const trigger = (wf.trigger as Record<string, unknown> | null) ?? {};

    // "Empty" = only the seed nodes (trigger + chat), nothing else built.
    // User policy: empty canvas → extend THIS one; non-empty → new canvas.
    const nonSeedKinds = nodes.filter(
      (n) => n.type !== 'trigger' && n.type !== 'chat',
    );
    const isEmpty = nonSeedKinds.length === 0;

    const nodesLine =
      nodes.length === 0
        ? '(none yet)'
        : nodes
            .map((n) => `  - ${n.id} | type=${n.type} | label="${n.label}"`)
            .join('\n');

    const policyBlock = isEmpty
      ? `THIS CANVAS IS EMPTY (only the seed trigger + chat, no real work yet).
→ When the user asks for a workflow, BUILD IT INTO THIS CANVAS.
  Call workflow_add_node and workflow_add_edge with workflowId="${workflowId}".
→ DO NOT call workflow_build_from_spec. That would spawn a separate canvas and
  leave the one the user is looking at empty. The user WILL be surprised.
→ Wire new processing nodes from the existing trigger (or downstream of
  it); do not leave nodes orphaned.`
      : `THIS CANVAS ALREADY HAS A WORKFLOW BUILT (${nonSeedKinds.length} non-seed node${nonSeedKinds.length === 1 ? '' : 's'}).
→ If the user wants to extend or edit this workflow, use
  workflow_add_node / workflow_add_edge / workflow_update_node with
  workflowId="${workflowId}".
→ If the user clearly wants a NEW, separate workflow (words like "new
  canvas", "another one", "separate", or a distinct unrelated topic),
  design it in chat first then call workflow_build_from_spec with an
  explicit JSON spec.`;

    return `\n\n--- Current Canvas ---
You are chatting inside a canvas, not /jkai. The workflow you are
embedded in is THE workflow for this conversation unless the user
explicitly asks for a separate canvas.

- workflowId: ${workflowId}
${slug ? `- slug: ${slug}` : ''}
- title: ${wf.description ?? wf.name}
- trigger type: ${trigger.type ?? 'manual'}
- node count: ${nodes.length} (trigger: ${hasTrigger ? 'present' : 'missing'})
- edge count: ${edges.length}
- state: ${isEmpty ? 'EMPTY (extend here)' : 'HAS WORKFLOW (extend or create new)'}

${policyBlock}

Rules that always apply:
${hasTrigger ? '- A trigger node already exists; do NOT add another (one per canvas).' : '- No trigger node yet. If the workflow needs scheduled/webhook/event firing, add ONE trigger node.'}
- When adding LLM/parser/output nodes, wire them from an existing node
  (usually the trigger or chat) — orphan nodes never run.
- Use workflow_list_node_types if you are unsure of the exact type string.

Existing nodes:
${nodesLine}
`;
  } catch (err) {
    console.warn('[general-chat] canvas context section failed:', err instanceof Error ? err.message : err);
    return '';
  }
}

async function buildPastedUrlsSection(
  userMessage: string,
  onProgress?: (text: string) => void,
  onStreamEvent?: (event: JobEvent) => void,
): Promise<string> {
  const urls = extractUrlsFromText(userMessage, 3);
  if (urls.length === 0) return '';

  onProgress?.(`[urls] Pre-fetching ${urls.length} pasted URL${urls.length === 1 ? '' : 's'}…\n`);
  onStreamEvent?.({ type: 'status', text: `Reading ${urls.length} link${urls.length === 1 ? '' : 's'}…` });

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const r = await fetchUrlContent(url);
        return { url, ok: true as const, result: r };
      } catch (err) {
        const message = isUrlFetchError(err) ? err.message : err instanceof Error ? err.message : 'fetch failed';
        return { url, ok: false as const, message };
      }
    }),
  );

  const sections = results.map((r) => {
    if (!r.ok) {
      return `[Pasted URL: ${r.url}]\n(could not fetch — ${r.message})`;
    }
    const { result } = r;
    const titleLine = result.title ? `Title: ${result.title}\n` : '';
    const truncNote = result.truncated ? '\n\n[content truncated]' : '';
    return `[Pasted URL: ${result.url}${result.finalUrl !== result.url ? ` → ${result.finalUrl}` : ''}]\n${titleLine}${result.content}${truncNote}`;
  });

  return `\n\n--- Pasted URLs ---\nThe user pasted the following links in their message. Their readable contents have been fetched for you below — do not re-fetch unless you need a different page.\n\n${sections.join('\n\n')}`;
}

export async function generalChat(
  input: { text: string; attachments?: JkaiAttachment[] },
  conversationHistory: HistoryMessage[],
  options: ChatOptions,
): Promise<{ response: string }> {
  const { onProgress, onToolProgress } = options;
  const userMessage = input.text;

  // Kick off the opening acknowledgement in parallel — it runs while the
  // heavy orchestrator system prompt is being assembled and the first LLM
  // round (which on reasoning models like GLM-5.x can sit silent for 10–20s)
  // is in flight. Aborted as soon as the orchestrator emits its own first
  // content token so we never double-up "Working…" callouts and the orchestrator's real reply.
  // Skipped for sub-agents (their output isn't meant for the user chat).
  const ackController = new AbortController();
  if (options.conversationId && (options.subagentDepth ?? 0) === 0) {
    void emitOpeningAck({
      userMessage,
      modelContext: options.modelContext,
      conversationId: options.conversationId,
      priceSnapshot: options.priceSnapshot,
      signal: ackController.signal,
    });
  }

  // Check if user wants to capture knowledge
  maybeIngestAsNote(userMessage);

  // Load HA entity context (needed to know if HA is available)
  let haEntities: any[] = [];
  try {
    const [haConfig] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    if (haConfig?.token && Array.isArray(haConfig.entityRegistry)) {
      haEntities = haConfig.entityRegistry as any[];
    }
  } catch (err) {
    console.warn('[general-chat] Failed to load HA config:', err instanceof Error ? err.message : err);
  }

  // Build system prompt — fetched in parallel to cut cold-start latency.
  // siteSection is synchronous, so no Promise.all entry for it.
  const siteSection = buildSiteSystemPromptSection();
  const graphSectionPromise =
    options.intelContextOverride != null
      ? Promise.resolve(options.intelContextOverride)
      : options.useIntelContext === false
        ? Promise.resolve('')
        : buildKnowledgeContext(userMessage);

  const [basePrompt, memorySection, graphSection, canvasSection, pastedUrlsSection] = await Promise.all([
    getCompiledPrompt(),
    buildMemorySection(),
    graphSectionPromise,
    buildCanvasContextSection(options.workflowId),
    buildPastedUrlsSection(userMessage, onProgress, options.onStreamEvent),
  ]);

  // Run the keyword classifier once, up front. Drives both the conditional
  // scraper playbook below and the toolset auto-activation further down.
  const inferred = inferToolsets(userMessage);

  // Stealth-scrape playbook — only injected when the user's message looks
  // scraper-related. Kept out of the always-on prompt so the typical /jkai
  // turn doesn't pay for ~1KB of guidance it never uses.
  const scraperSection = inferred.includes('scraper')
    ? `\n\n--- Web scraping ---\nThe \`stealth-scrape\` node is the pattern for reading live web pages — job boards, listings, prices, schedules, content behind cookie walls. It runs a stealth-patched Playwright on homeserv's residential IP and dispatches through a saved Python script keyed to a stable per-domain \`profile\` (e.g. \`civilservicejobs-gov-uk\`). Scripts have \`page\` (persistent context, cookies retained) and \`vars\` (string dict) in scope and \`return\` a list of dicts.\n\nWhen designing a scrape:\n1. \`scraper_script_list\` first — reuse an existing profile if one matches.\n2. If editing: \`scraper_script_read\` → modify → \`scraper_script_save\` → \`scraper_script_test\` to verify.\n3. If none exists: set \`goal\` + \`searchQuery\` on the \`stealth-scrape\` node — the first run authors and saves a script; subsequent runs replay it.\n\nTypical scrape canvas: \`trigger → (data-store get, stealth-scrape) → merge → transform (diff vs stored URLs) → llm-call (format) → gmail-send / whatsapp → data-store set\`. Keep transforms small (in-process, no sandbox); cap LLM prompts (few hundred chars per description); use \`bodyHtml\` not \`bodyText\` on \`gmail-send\` when output has links or lists.`
    : '';

  // API-first data answering — always on and deliberately compact. For any
  // factual / numeric / current / external question the model should reach a
  // real data source (api_search → api_call) before answering from memory.
  // The tools it names (api_search, api_call, datastore_query) are
  // ESSENTIAL_TOOL_NAMES, so they stay reachable regardless of which toolsets
  // the classifier activated — hence unconditional rather than inferred-gated.
  const apiFirstSection = `\n\n--- API-first data answering ---\nFor questions about current, factual, numeric, or external data, prefer a live source over model memory: (1) call \`api_search\` first to find a catalogued API for the ask; (2) fetch with \`api_call\` and cite the API you used inline, where its figure lands; (3) fall back to your own knowledge only when no API fits — and say so; (4) if you hit a useful API that isn't catalogued yet, \`api_register\` it. Recurring structured data worth querying again belongs in the datastore — \`datastore_save\` to record it, \`datastore_query\` to read it back — not \`save_memory\`, which is for distilled personal facts.`;

  // Plan/clarify gates only fire when there's a UI to render the card and
  // PATCH the ack — that's /jkai today. Canvas chat (workflowId set) does
  // not consume plan/clarify SSE events, so the prompt must not invite the
  // model to emit them or the job stalls.
  const supportsGates = options.jobId && (options.subagentDepth ?? 0) === 0 && !options.workflowId;

  const planSection = supportsGates
    ? `\n\n--- Plan phase ---\nA plan exists to get the user's consent BEFORE something happens that they cannot simply undo by reading the answer. Emit one ONLY if the turn will write, modify, delete, publish, send, spend, run code, or change state anywhere — on the site, a device, an inbox, or a third party.\n\nDo NOT emit a plan for read-only work. Looking things up, searching, walking the graph, reading files, checking status — just call the tools and answer, however many lookups it takes. Nobody needs to approve a question.\n\n<plan>{\n  "summary": "one sentence of what you will do",\n  "steps": [\n    {"id": "s1", "title": "Short step title", "detail": "One-line detail of what this step does", "kind": "read" | "write" | "run" | "external"}\n  ],\n  "filesToTouch": [{"path": "...", "action": "create" | "modify" | "delete"}]\n}</plan>\n\nSet each step's "kind" accurately — it is load-bearing, not decoration. A plan whose steps are all "read" with no filesToTouch is treated as having nothing to approve and runs immediately; mislabelling a write as a read skips the user's say-so entirely.\n\nAfter emitting this block, STOP. Do not call any tools in the same message. The system will return with one of: "Plan approved — proceed.", "Plan rejected — stop.", or "Adjust the plan: <user feedback>". If the plan is adjusted, revise and emit a new <plan>. Only call tools after approval.`
    : '';

  const clarifySection = supportsGates
    ? `\n\n--- Clarify phase ---\nIf the user's request is genuinely ambiguous — you cannot safely proceed without more information, and making a reasonable assumption would likely produce a wrong answer — emit a clarify block instead of answering or calling tools:\n\n<clarify>{\n  "questions": [\n    {"id": "q1", "text": "Question text", "kind": "freeform"},\n    {"id": "q2", "text": "Pick one", "kind": "choice", "choices": ["a", "b", "c"]}\n  ]\n}</clarify>\n\nLimit to at most 3 questions. Do NOT clarify when a reasonable assumption works. The system will return the user's answers as a plain-text message you can incorporate and then proceed normally.`
    : '';

  // The skills index. One line per skill with its FULL description — Hermes cut
  // these to 60 characters, which is why whichever skill happened to fit a
  // keyword inside that budget won the routing regardless of merit.
  const skillsIndex = renderSkillIndex();
  const skillsSection = skillsIndex
    ? `\n\n--- Skills ---\nCurated playbooks for specific jobs. If one covers what you are about to do, read it with skill_view(id) BEFORE starting — it carries the specifics, constraints and traps that general knowledge does not. Prefer loading one over guessing; do not load one that is merely adjacent.\n\n${skillsIndex}\n`
    : '';

  // Older turns are summarised rather than dropped. `slice(-MAX_HISTORY)` was
  // silent amnesia: message 31 back simply vanished, with nothing in the prompt
  // saying so, which is how a long thread came to contradict what it agreed to
  // an hour earlier. Computed here because the prompt section below needs it.
  const compressed = await compressHistory(conversationHistory, options.conversationId, MAX_HISTORY);
  // Carries what the summarised turns said, or says plainly that they are gone.
  const compressionSection = renderCompressionSection(compressed);

  const personaSection = options.personaPrompt?.trim()
    ? `You are acting as a specialist agent. Adopt this role for the whole turn:\n${options.personaPrompt.trim()}\n\n---\n\n`
    : '';
  const systemContent = `${personaSection}${basePrompt}${siteSection}${skillsSection}${compressionSection}${memorySection}${graphSection}${canvasSection}${pastedUrlsSection}${scraperSection}${apiFirstSection}${clarifySection}${planSection}`;

  // Build messages
  const messages: Array<any> = [
    { role: 'system', content: systemContent },
  ];

  // What this conversation's model can actually read. Anything it cannot is
  // pre-analysed into text rather than sent as a part the provider will reject
  // or quietly drop — this is the job Hermes used to do out of sight, and the
  // reason attachments kept working on a text-only chat model.
  const mediaCaps = getModelCapabilities(options.modelContext);

  const recentHistory = compressed.messages;
  for (const h of recentHistory) {
    if (h.role === 'user' && h.attachments && h.attachments.length > 0) {
      const parts = await buildMultimodalContent(h.content, h.attachments, { caps: mediaCaps });
      messages.push({ role: 'user', content: parts as any });
    } else {
      messages.push({ role: h.role, content: h.content } as any);
    }
  }

  const userParts = await buildMultimodalContent(userMessage, input.attachments ?? [], {
    caps: mediaCaps,
  });
  const maxTurnBytes = Number(process.env.JKAI_MAX_TURN_BYTES ?? 104857600);
  if (encodedSizeBytes(userParts) > maxTurnBytes) {
    throw new Error(`Encoded turn payload exceeds JKAI_MAX_TURN_BYTES (${maxTurnBytes})`);
  }
  // Collapse to plain string when there are no non-text parts, to keep backward compat with
  // models that reject content arrays.
  const userContent = userParts.length === 1 && userParts[0].type === 'text'
    ? userParts[0].text
    : userParts;
  messages.push({ role: 'user', content: userContent as any });

  // --- Tiered tool assembly ---
  // Always include meta-tools, and the discovery toolset alongside them: tools
  // for FINDING tools are useless if you must already know to activate them.
  // Seeded from the registry rather than hand-copied into META_TOOL_DEFINITIONS
  // so the schemas cannot drift from the `register()` calls that define them.
  const activeTools: Array<any> = [
    ...META_TOOL_DEFINITIONS,
    ...getToolsetDefinitions('discovery'),
  ];
  const activatedToolsets = new Set<string>();

  // Always-on background-task toolsets: follow-up queue, heartbeat actions,
  // and one-shot scheduled callbacks. These need to be reachable on every
  // turn so any "I'll check in" promise can be backed by an actual scheduled
  // action without forcing the model to call activate_toolset first.
  // (Formerly a single 'system' toolset — split into three for clarity.)
  for (const ts of ['followups', 'heartbeat', 'schedule']) {
    activeTools.push(...getToolsetDefinitions(ts));
    activatedToolsets.add(ts);
  }

  // Include agent_spawn as a meta-tool available in all chats — but ONLY
  // when this IS a top-level orchestrator call (not itself a sub-agent).
  if ((options.subagentDepth ?? 0) === 0 && options.jobId) {
    // Lazy import to keep sub-agent logic out of cold prompt assembly.
    const { AGENT_SPAWN_SCHEMA } = await import('./sub-agent');
    activeTools.push(AGENT_SPAWN_SCHEMA);
  }

  // Auto-activate the toolsets the classifier matched earlier in this turn.
  for (const ts of inferred) {
    if (ts === 'home' && haEntities.length === 0) continue;
    activeTools.push(...getToolsetDefinitions(ts));
    activatedToolsets.add(ts);
  }

  // Canvas context: always include the workflows toolset so the model
  // can build/modify THIS canvas without needing the user to say a magic
  // keyword first.
  if (options.workflowId && !activatedToolsets.has('workflows')) {
    activeTools.push(...getToolsetDefinitions('workflows'));
    activatedToolsets.add('workflows');
  }

  // If we're inside an empty canvas, hide workflow_build_from_spec entirely
  // — the model should extend the current canvas, not spawn a parallel one.
  if (options.workflowId) {
    try {
      const siblingNodes = await db
        .select()
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, options.workflowId));
      const hasRealNodes = siblingNodes.some(
        (n) => n.type !== 'trigger' && n.type !== 'chat',
      );
      if (!hasRealNodes) {
        for (let i = activeTools.length - 1; i >= 0; i--) {
          const t = activeTools[i] as { function?: { name?: string } };
          if (t.function?.name === 'workflow_build_from_spec' || t.function?.name === 'workflow_create') {
            activeTools.splice(i, 1);
          }
        }
      }
    } catch {
      /* non-fatal — the system prompt is still a strong nudge */
    }
  }

  // Visualise tools are always available — the LLM should be able to reach
  // for render_chart/render_map/render_table whenever it wants to answer
  // with a multimedia response.
  if (!activatedToolsets.has('visualise')) {
    activeTools.push(...getToolsetDefinitions('visualise'));
    activatedToolsets.add('visualise');
  }

  // Custom-tools meta-tools (author/promote ephemeral tools) are always
  // available — these were previously reachable via the 'visualise' toolset
  // before being moved to their own 'custom-tools' toolset.
  if (!activatedToolsets.has('custom-tools')) {
    activeTools.push(...getToolsetDefinitions('custom-tools'));
    activatedToolsets.add('custom-tools');
  }

  const baseCtx = options.modelContext;
  // Smarter / larger-context model used for plan/clarify rounds and any
  // turn whose prompt has grown past the threshold. Sub-agent calls and
  // canvas-bound calls stay on the base model — those are tactical, not
  // strategic. Returns null when the operator has disabled the split.
  const isOrchestrator = (options.subagentDepth ?? 0) === 0 && !!options.jobId && !options.workflowId;
  const thinkingCtx: ModelContext | null = isOrchestrator ? await resolveThinkingModel() : null;
  const THINKING_PROMPT_CHAR_THRESHOLD = 160_000; // ~40k tokens (4 chars/token)

  let responseText = '';

  // Derive the tool-call budget for this turn. The caller can override
  // explicitly; otherwise we look at the user message for extended-autonomy
  // phrases. Canvas-bound chats start higher because plan/clarify gates are
  // disabled there (no jobId-based plan extraction), so we can't bump the
  // budget mid-loop based on plan length — and canvas builds are inherently
  // multi-step (add nodes, wire edges, lint, run, repair). The plan-
  // extraction branch below may still bump this further when applicable.
  const isCanvasChat = !!options.workflowId;
  const baseDefault = isCanvasChat ? EXTENDED_TOOL_ROUNDS : DEFAULT_TOOL_ROUNDS;
  let maxRounds = options.maxRounds
    ? Math.max(1, Math.min(ABSOLUTE_TOOL_ROUNDS, options.maxRounds))
    : detectExtendedAutonomy(userMessage)
      ? Math.max(EXTENDED_TOOL_ROUNDS, baseDefault)
      : baseDefault;
  if (maxRounds !== DEFAULT_TOOL_ROUNDS) {
    onProgress?.(`[budget] tool-call budget set to ${maxRounds} rounds for this turn\n`);
  }

  for (let round = 0; round < maxRounds; round++) {
    const isFinalRound = round === maxRounds - 1;

    // --- Per-turn model selection ---
    // Use the thinking-tier model (e.g. glm-5.1) for "decision" turns: the
    // first round (plan / clarify decision), turns resuming after a plan
    // adjustment or clarify answers (the LLM is re-deciding scope), and
    // any turn where the prompt has grown past the large-context bar.
    // Tactical execution rounds stay on the cheaper / faster base model.
    const promptChars = messages.reduce(
      (n, m) => n + (typeof m.content === 'string' ? m.content.length : 0),
      0,
    );
    const lastMsg = messages[messages.length - 1];
    const lastUserText = lastMsg?.role === 'user' && typeof lastMsg.content === 'string' ? lastMsg.content : '';
    const useThinking = !!thinkingCtx && (
      round === 0
      || lastUserText.startsWith('Adjust the plan:')
      || lastUserText.startsWith('My answers:')
      || promptChars > THINKING_PROMPT_CHAR_THRESHOLD
    );
    const turnCtx = useThinking && thinkingCtx ? thinkingCtx : baseCtx;
    const { client, model } = await getLLMClient(turnCtx);

    // Halfway through available rounds: get a plain-English status update so
    // the user can see progress. Separate call with no tools, doesn't count
    // against MAX_TOOL_ROUNDS. Persisted as a proper assistant message with
    // source=status_update so it shows up in the chat stream (not just the
    // working panel) and survives page reloads.
    if (round === 5) {
      try {
        const statusResp = await client.chat.completions.create({
          model,
          messages: [
            ...messages,
            {
              role: 'user',
              content: 'Pause briefly. Write a short, casual update (1-2 sentences max) — what have you found so far and what are you about to try? Conversational tone, like you\'re quickly checking in mid-task. No tool calls, no bullet points, no "I have queried" robotic phrasing. Just a quick note.',
            },
          ],
          temperature: 0.3,
          // Reasoning model needs ~4000 tokens just to think before producing
          // any output — 300 would guarantee empty content.
          max_tokens: 6000,
        });
        if (options.conversationId) {
          // Fire-and-forget: ~30ms per call we don't need to block on
          recordConversationUsage(
            options.conversationId,
            parseUsage(statusResp.usage),
            options.priceSnapshot,
          ).catch((e) => console.warn('[general-chat] usage record failed:', e));
        }
        const statusText = statusResp.choices[0]?.message?.content?.trim();
        if (statusText && options.conversationId) {
          // Persist as a proper assistant message with source marker in metadata
          await db.insert(orchestratorChats).values({
            conversationId: options.conversationId,
            role: 'assistant',
            content: statusText,
            metadata: { source: 'status_update' },
          });
          // Push via SSE so the live chat UI receives it before the final response.
          // Note: the per-job SSE stream (options.onStreamEvent { type: 'status' })
          // would render the SAME status_update message a second time in the UI,
          // since the frontend subscribes to both this and the conversation stream.
          // Keep only the conversation-level notify here — it's also the path that
          // survives reloads via the persisted orchestrator_chats row above.
          notifySubscribers(options.conversationId, {
            role: 'assistant',
            content: statusText,
            source: 'status_update',
          });
          // Hint to onProgress stream too for debug visibility
          onProgress?.(`[status] ${statusText.slice(0, 80)}\n`);
        }
      } catch (err) {
        console.warn('[general-chat] Status update failed:', err instanceof Error ? err.message : err);
      }
    }

    // On the final round, drop tools to force a text response instead of
    // another tool call. Also inject a directive so the model summarises
    // using what it already gathered.
    const filteredActiveTools = options.toolWhitelist
      ? activeTools.filter((t: any) => options.toolWhitelist!.includes(t?.function?.name))
      : activeTools;
    const tools = isFinalRound ? undefined : (filteredActiveTools.length > 0 ? filteredActiveTools : undefined);
    if (isFinalRound) {
      messages.push({
        role: 'user',
        content: 'You have reached the final step. Write your complete answer now based on the information you have already gathered. Do not request more tool calls.',
      });
    }

    // --- Streaming main completion ---
    // Stream tokens as they arrive so the client can render incrementally.
    // We accumulate content + tool_calls (per-index assembly) and synthesise
    // a `msg` object compatible with the rest of the loop afterwards.
    let fullContent = '';
    const fullToolCalls: Array<{ index: number; id: string; name: string; args: string }> = [];
    let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
    let finishReason: string | null = null;

    if (options.jobId) setJobPhase(options.jobId, 'thinking', 'Calling LLM…');

    // Narration ticker — keeps the user informed during long reasoning phases
    // before any token has been streamed. Reasoning models like GLM-5.x can
    // sit silent for 60-180s on complex requests; without this the chat just
    // shows "Working…" with no progress. Each tick is also a non-heartbeat
    // SSE event, which resets the watchdog idle timer (defended-in-depth
    // against the 120s watchdog kill).
    let firstTokenSeen = false;
    // Wall-clock of the last reasoning delta. While the model is actually
    // streaming its reasoning the user can watch it happen in the Reasoning
    // panel, so the synthetic narration below would just be talking over it.
    // Left as a timestamp rather than a boolean so narration comes BACK if
    // reasoning stalls — a model that thinks for 10s then goes quiet for two
    // minutes still needs the "bear with me" line, and still needs the
    // watchdog-resetting SSE event that comes with it.
    let lastReasoningAt = 0;
    const turnStartedAt = Date.now();
    const narrationTicker = options.jobId ? setInterval(() => {
      if (firstTokenSeen) return;
      if (lastReasoningAt && Date.now() - lastReasoningAt < 20_000) return;
      const elapsedSec = Math.round((Date.now() - turnStartedAt) / 1000);
      let text: string;
      if (elapsedSec < 30) text = `Still thinking — model is reasoning through it (${elapsedSec}s).`;
      else if (elapsedSec < 60) text = `Reasoning chain is long, working on it (${elapsedSec}s).`;
      else if (elapsedSec < 120) text = `Deep reasoning — almost there (${elapsedSec}s).`;
      else text = `This is a chunky one — bear with me (${elapsedSec}s).`;
      options.onStreamEvent?.({ type: 'status', text });
    }, 20_000) : undefined;
    const clearNarration = () => { if (narrationTicker) clearInterval(narrationTicker); };

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 16384,
        ...(tools ? { tools } : {}),
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          if (chunk.usage) lastUsage = chunk.usage;
          continue;
        }
        const delta = choice.delta ?? {};
        // Reasoning goes to the collapsible Reasoning panel, never into the
        // answer bubble. Emitted before the content branch because that is the
        // order it actually arrives in: reasoning models deliberate first and
        // answer second, and surfacing it is the whole point — it removes the
        // dead-air window that the narration ticker above only papered over.
        // Deliberately not accumulated into `fullContent` or persisted: the
        // Hermes path treats reasoning as live-only too, so a reload drops it
        // on both engines rather than one.
        const reasoningDelta = extractReasoningDelta(delta);
        if (reasoningDelta) {
          if (!lastReasoningAt && options.jobId) setJobPhase(options.jobId, 'thinking', 'Reasoning…');
          lastReasoningAt = Date.now();
          options.onStreamEvent?.({ type: 'thinking', delta: reasoningDelta });
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            clearNarration();
            if (options.jobId) setJobPhase(options.jobId, 'thinking', 'Streaming reply…');
            // Orchestrator is now producing its own assistant content — drop
            // the parallel opening ack so we don't render two "Working…"
            // callouts back-to-back when the orchestrator turns out to be
            // fast enough to beat the ack call.
            ackController.abort();
          }
          fullContent += delta.content;
          options.onStreamEvent?.({ type: 'token', delta: delta.content });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls as any[]) {
            const idx = tc.index ?? 0;
            let acc = fullToolCalls.find((t) => t.index === idx);
            if (!acc) {
              acc = { index: idx, id: tc.id ?? '', name: '', args: '' };
              fullToolCalls.push(acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) lastUsage = chunk.usage;
      }
      clearNarration();
    } catch (err: any) {
      clearNarration();
      // Do not retry mid-stream. If the initial create() throws (or stream
      // errored before any iteration), do a single non-streaming retry on
      // 429 only — same shape as before but simpler.
      const status = err?.status;
      if (status === 429) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const retry = await client.chat.completions.create({
            model,
            messages,
            temperature: 0.4,
            max_tokens: 16384,
            ...(tools ? { tools } : {}),
          });
          const rchoice = retry.choices[0];
          fullContent = rchoice?.message?.content ?? '';
          fullToolCalls.length = 0;
          (rchoice?.message?.tool_calls ?? []).forEach((tc: any, i: number) => {
            fullToolCalls.push({
              index: i,
              id: tc.id,
              name: tc.function.name,
              args: tc.function.arguments,
            });
          });
          lastUsage = retry.usage;
          finishReason = rchoice?.finish_reason ?? null;
        } catch (retryErr: any) {
          const rstatus = retryErr?.status || retryErr?.code || 'unknown';
          const detail = retryErr?.error?.message || retryErr?.message || String(retryErr);
          throw new Error(`LLM error (${rstatus}): ${detail}`);
        }
      } else {
        const detail = err?.error?.message || err?.message || String(err);
        throw new Error(`LLM error (${status ?? 'unknown'}): ${detail}`);
      }
    }

    // Fire-and-forget cost recording (~30ms, no need to block)
    if (options.conversationId) {
      recordConversationUsage(
        options.conversationId,
        parseUsage(lastUsage as any),
        options.priceSnapshot,
      ).catch((e) => console.warn('[general-chat] usage record failed:', e));
    }

    // Reconstruct an assistant message object compatible with the rest of
    // the loop and the OpenAI tool-calling protocol.
    const msg: any = {
      role: 'assistant',
      content: fullContent,
      tool_calls: fullToolCalls.length > 0
        ? fullToolCalls.map((t) => ({
            id: t.id || `call_${t.index}`,
            type: 'function',
            function: { name: t.name, arguments: t.args },
          }))
        : undefined,
    };

    // --- Clarify-phase interception (every round — the LLM may emit
    // follow-up <clarify> blocks after the user answers, and those must also
    // route to ClarifyCard, not the raw chat bubble). Top-level jobs only.
    // Takes priority over plan interception: ask questions first, plan only
    // once we know what we're doing.
    // Plan/clarify gates require a UI that can render the card and PATCH
    // the job with an ack. Only /jkai has that today — canvas chat (workflowId
    // set) consumes only token/done/error events, so a plan emission would
    // stall the job forever. Skip these phases when embedded in a canvas.
    if (options.jobId && (options.subagentDepth ?? 0) === 0 && !options.workflowId && typeof msg.content === 'string' && msg.content.includes('<clarify>')) {
      const extracted = extractClarify(msg.content);
      if (extracted) {
        msg.tool_calls = undefined;
        msg.content = extracted.cleaned || '(clarify emitted)';

        const { answers } = await awaitClarifyAnswers(options.jobId, extracted.questions);

        // Feed answers back as a plain-text follow-up turn.
        const answerLines = Object.entries(answers)
          .map(([id, val]) => {
            const q = extracted.questions.find((qq) => qq.id === id);
            return q ? `${q.text} — ${val}` : `${id}: ${val}`;
          })
          .join('\n');

        messages.push(msg);
        messages.push({ role: 'user', content: `My answers:\n${answerLines}` });
        continue;
      }
    }

    // --- Plan-phase interception (every round — the LLM may emit a revised
    // plan after an "adjusted" decision, and that revision must also go
    // through PlanCard, not the raw chat bubble). Top-level jobs only. ---
    if (options.jobId && (options.subagentDepth ?? 0) === 0 && !options.workflowId && typeof msg.content === 'string' && msg.content.includes('<plan>')) {
      const extracted = extractPlan(msg.content);
      if (extracted) {
        // Tool calls in the same turn as a plan would be premature — discard
        // them; the LLM must wait for approval. (In practice models don't
        // emit both in the same turn with the prompt above, but belt and
        // braces.)
        msg.tool_calls = undefined;
        // Some OpenAI-compatible providers reject assistant messages with
        // empty content + no tool_calls; substitute a marker when the only
        // thing the model emitted was the plan block.
        msg.content = extracted.cleaned || '(plan emitted)';

        // A plan with no side effects has nothing to approve (see
        // isReadOnlyPlan), so proceed as though the user had said yes rather
        // than stalling the turn on a card whose only sensible answer is
        // "approve". Anything that writes, runs, sends or touches a file still
        // goes to the user.
        const autoApproved = isReadOnlyPlan(extracted.plan);
        if (autoApproved) {
          onProgress?.(`[plan] read-only plan (${extracted.plan.steps.length} step(s)) — proceeding without an approval card\n`);
        }
        const decision = autoApproved
          ? ({ decision: 'approved' } as const)
          : await awaitPlanApproval(options.jobId, extracted.plan);

        if (decision.decision === 'rejected') {
          responseText = extracted.cleaned || 'Plan rejected — stopping here.';
          break;
        }

        // If the approved plan has many steps, give the loop more rounds
        // so it doesn't run out mid-execution. Honour any explicit caller
        // override — never expand past it. Heuristic: 3 rounds per step is
        // about right for workflow builds (add-node + add-edge + verify).
        if (decision.decision === 'approved' && !options.maxRounds) {
          const stepCount = extracted.plan.steps.length;
          const projected = Math.min(ABSOLUTE_TOOL_ROUNDS, Math.max(maxRounds, stepCount * 3));
          if (projected > maxRounds) {
            onProgress?.(`[budget] plan has ${stepCount} steps — extending budget ${maxRounds} → ${projected} rounds\n`);
            maxRounds = projected;
          }
        }

        // Feed the decision back in. The LLM sees its own plan block in the
        // conversation history (via `msg` being pushed below) plus a system
        // nudge matching what the prompt promised.
        const nudge = decision.decision === 'approved'
          ? 'Plan approved — proceed.'
          : `Adjust the plan: ${decision.adjustment ?? '(no adjustment text)'}`;

        messages.push(msg);
        messages.push({ role: 'user', content: nudge });
        continue;   // fresh round; LLM either executes or revises the plan
      }
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const trimmed = (msg.content as string | undefined)?.trim();
      if (!trimmed) {
        const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
        console.warn(
          `[general-chat] Empty response from ${model}. ` +
          `round=${round} finish_reason=${finishReason} ` +
          `messages=${messages.length} prompt_chars=${promptChars} ` +
          `usage=${JSON.stringify(lastUsage)}`,
        );
      }
      responseText = trimmed || `Sorry, the model (${model}) returned an empty response. This may indicate rate limiting or a service issue.`;
      break;
    }

    // Process tool calls — push assistant message, then run all tools in parallel.
    messages.push(msg);

    // Note: some tools mutate `activeTools` / `activatedToolsets` (activate_toolset,
    // create_tool, delete_tool). Under Promise.all these mutations are not
    // strictly ordered relative to siblings, but that's OK in practice — the
    // LLM very rarely calls activate + execute in the same round, and the
    // mutations only affect *future* rounds.
    const toolOutcomes = await Promise.all(
      msg.tool_calls.map((toolCall: any) => runSingleToolCall(toolCall, {
        activeTools,
        activatedToolsets,
        haEntities,
        onToolProgress,
        onProgress,
        onStreamEvent: options.onStreamEvent,
        conversationId: options.conversationId,
        parentJobId: options.jobId ?? null,
        modelContext: options.modelContext,
        subagentDepth: options.subagentDepth ?? 0,
        toolWhitelist: options.toolWhitelist,
      })),
    );
    for (const { toolMessage } of toolOutcomes) {
      messages.push(toolMessage);
    }
  }

  if (!responseText) {
    responseText = `Sorry, the model did not produce a final response after ${maxRounds} tool rounds.`;
  }

  return { response: responseText };
}
