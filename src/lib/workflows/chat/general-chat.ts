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
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
import { META_TOOL_DEFINITIONS, getToolsetDefinitions, buildSiteSystemPromptSection } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool, isRegisteredTool } from '$lib/workflows/site-tools/executor';
import { handleJkaiHelp, handleCreateTool, handleListCustomTools, handleDeleteTool } from '$lib/workflows/site-tools/meta-tools';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';
import { enqueueFollowUp, notifySubscribers } from '$lib/workflows/chat/followup-queue';
import { buildCheckFn } from '$lib/workflows/site-tools/tools/followup';
import type { JobEvent } from '$lib/workflows/chat/job-store';
import { buildMultimodalContent, encodedSizeBytes } from '$lib/jkai/media/multimodal';
import type { JkaiAttachment } from '$lib/db/schema';
import type { HistoryMessage } from './conversation-history';
import { buildKnowledgeContext } from '$lib/jkai/intel/context';
import { createNote, processNote } from '$lib/jkai/intel/ingest';

const MAX_HISTORY = 30;
const MAX_TOOL_ROUNDS = 10;

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

  onToolProgress?.({ tool: fnName, toolCallId: toolCall.id, args: fnArgs, status: 'running' });
  onProgress?.(`${fnName}: running\n`);
  onStreamEvent?.({ type: 'tool_start', tool: fnName, args: fnArgs, toolCallId: toolCall.id });

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
  } else if (isRegisteredTool(fnName)) {
    toolResult = await executeSiteTool(fnName, fnArgs);
  } else {
    toolResult = { error: `Unknown function: ${fnName}` };
  }

  // Auto-register follow-ups for known async tools
  const autoFollowUpTools: Record<string, { type: string; prompt: string }> = {
    research_start: { type: 'research', prompt: 'The research is complete. Summarise the key findings for the user. If they asked for a blog post or other output, produce it now.' },
    build_create: { type: 'build', prompt: 'The build is complete. Tell the user the result and provide the URL if it was published.' },
  };
  if (fnName in autoFollowUpTools) {
    const resultData = toolResult?.data as Record<string, unknown> | undefined;
    const taskId = resultData?.id as string | undefined;
    console.log(`[followup-auto] Tool=${fnName} convId=${conversationId} success=${toolResult?.success} taskId=${taskId}`);
    if (conversationId && toolResult?.success && taskId) {
      const autoConfig = autoFollowUpTools[fnName];
      const checkFn = buildCheckFn(autoConfig.type, taskId);
      if (checkFn) {
        enqueueFollowUp({
          conversationId,
          taskType: autoConfig.type,
          taskId,
          checkFn,
          completionPrompt: autoConfig.prompt,
          delayMs: 30_000,
        });
      }
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
  onStreamEvent?.({ type: 'tool_result', tool: fnName, result: progressResult, status, toolCallId: toolCall.id });

  // Truncate large tool results to avoid overwhelming the LLM context
  let resultStr = JSON.stringify(toolResult);
  if (resultStr.length > 8000) {
    resultStr = resultStr.slice(0, 8000) + '... [truncated — result too large for chat context]';
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
→ DO NOT call workflow_create. That would spawn a separate canvas and
  leave the one the user is looking at empty. The user WILL be surprised.
→ Wire new processing nodes from the existing trigger (or downstream of
  it); do not leave nodes orphaned.`
      : `THIS CANVAS ALREADY HAS A WORKFLOW BUILT (${nonSeedKinds.length} non-seed node${nonSeedKinds.length === 1 ? '' : 's'}).
→ If the user wants to extend or edit this workflow, use
  workflow_add_node / workflow_add_edge / workflow_update_node with
  workflowId="${workflowId}".
→ If the user clearly wants a NEW, separate workflow (words like "new
  canvas", "another one", "separate", or a distinct unrelated topic),
  call workflow_create — it will create a new canvas with a short slug.`;

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

export async function generalChat(
  input: { text: string; attachments?: JkaiAttachment[] },
  conversationHistory: HistoryMessage[],
  options: ChatOptions,
): Promise<{ response: string }> {
  const { onProgress, onToolProgress } = options;
  const userMessage = input.text;

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

  const [basePrompt, memorySection, graphSection, canvasSection] = await Promise.all([
    getCompiledPrompt(),
    buildMemorySection(),
    graphSectionPromise,
    buildCanvasContextSection(options.workflowId),
  ]);
  const systemContent = `${basePrompt}${siteSection}${memorySection}${graphSection}${canvasSection}`;

  // Build messages
  const messages: Array<any> = [
    { role: 'system', content: systemContent },
  ];

  const recentHistory = conversationHistory.slice(-MAX_HISTORY);
  for (const h of recentHistory) {
    if (h.role === 'user' && h.attachments && h.attachments.length > 0) {
      const parts = await buildMultimodalContent(h.content, h.attachments);
      messages.push({ role: 'user', content: parts as any });
    } else {
      messages.push({ role: h.role, content: h.content } as any);
    }
  }

  const userParts = await buildMultimodalContent(userMessage, input.attachments ?? []);
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
  // Always include meta-tools
  const activeTools: Array<any> = [...META_TOOL_DEFINITIONS];
  const activatedToolsets = new Set<string>();

  // Keyword pre-classification: auto-activate likely toolsets
  const inferred = inferToolsets(userMessage);
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

  // If we're inside an empty canvas, hide workflow_create entirely — the
  // model should extend the current canvas, not spawn a parallel one.
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
          if (t.function?.name === 'workflow_create') activeTools.splice(i, 1);
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

  const { client, model } = await getLLMClient(options.modelContext);
  let responseText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isFinalRound = round === MAX_TOOL_ROUNDS - 1;

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
          // Push via SSE so the live chat UI receives it before the final response
          notifySubscribers(options.conversationId, {
            role: 'assistant',
            content: statusText,
            source: 'status_update',
          });
          // Hint to onProgress stream too for debug visibility
          onProgress?.(`[status] ${statusText.slice(0, 80)}\n`);
          // Also emit a stream event so the per-job SSE clients can render it
          options.onStreamEvent?.({ type: 'status', text: statusText });
        }
      } catch (err) {
        console.warn('[general-chat] Status update failed:', err instanceof Error ? err.message : err);
      }
    }

    // On the final round, drop tools to force a text response instead of
    // another tool call. Also inject a directive so the model summarises
    // using what it already gathered.
    const tools = isFinalRound ? undefined : (activeTools.length > 0 ? activeTools : undefined);
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
        if (typeof delta.content === 'string' && delta.content.length > 0) {
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
    } catch (err: any) {
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
      })),
    );
    for (const { toolMessage } of toolOutcomes) {
      messages.push(toolMessage);
    }
  }

  if (!responseText) {
    responseText = `Sorry, the model (${model}) did not produce a final response after ${MAX_TOOL_ROUNDS} tool rounds.`;
  }

  return { response: responseText };
}
