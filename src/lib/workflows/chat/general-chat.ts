// src/lib/workflows/chat/general-chat.ts — full replacement

import { db } from '$lib/db';
import { homeAssistantConfig, jkaiMemories, orchestratorChats, conversations } from '$lib/db/schema';
import { eq, isNull, desc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { META_TOOL_DEFINITIONS, getToolsetDefinitions, buildSiteSystemPromptSection } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool, isRegisteredTool } from '$lib/workflows/site-tools/executor';
import { handleJkaiHelp, handleCreateTool, handleListCustomTools, handleDeleteTool } from '$lib/workflows/site-tools/meta-tools';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';
import { enqueueFollowUp, notifySubscribers } from '$lib/workflows/chat/followup-queue';
import { buildCheckFn } from '$lib/workflows/site-tools/tools/followup';

const MAX_HISTORY = 30;
const MAX_TOOL_ROUNDS = 10;

interface ToolProgress {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

interface ChatOptions {
  workflowId?: string | null;
  conversationId?: string | null;
  onProgress?: (text: string) => void;
  onToolProgress?: (step: ToolProgress) => void;
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

export async function generalChat(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  options: ChatOptions = {},
): Promise<{ response: string }> {
  const { onProgress, onToolProgress } = options;

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

  // Build system prompt — no longer includes HA entity registry or full tool list
  const basePrompt = await getCompiledPrompt();
  const siteSection = buildSiteSystemPromptSection();
  const memorySection = await buildMemorySection();
  const systemContent = `${basePrompt}${siteSection}${memorySection}`;

  // Build messages
  const messages: Array<any> = [
    { role: 'system', content: systemContent },
  ];

  const recentHistory = conversationHistory.slice(-MAX_HISTORY);
  for (const h of recentHistory) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: userMessage });

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

  const client = getOpenAIClient();
  const model = getModel();
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

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.4,
          // glm-5-turbo is a reasoning model — it spends ~4000 tokens on
          // chain-of-thought reasoning BEFORE emitting any output. max_tokens
          // must cover both the thinking and the visible output, so we set
          // it generously. With finish_reason=length and reasoning_tokens
          // hitting the cap, the model returns empty content.
          max_tokens: 16384,
          ...(tools ? { tools } : {}),
        });
        break;
      } catch (err: any) {
        if (err?.status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
          continue;
        }
        const status = err?.status || err?.code || 'unknown';
        const detail = err?.error?.message || err?.message || String(err);
        throw new Error(`LLM error (${status}): ${detail}`);
      }
    }

    const choice = response?.choices[0];
    if (!choice) {
      console.warn('[general-chat] No choice in LLM response');
      break;
    }

    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const trimmed = msg.content?.trim();
      if (!trimmed) {
        // Diagnostic: log why we got an empty response. Common culprits are
        // max_tokens truncation mid-tool-call, safety filters, or the model
        // just giving up on a complex task.
        const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
        console.warn(
          `[general-chat] Empty response from ${model}. ` +
          `round=${round} finish_reason=${choice.finish_reason} ` +
          `messages=${messages.length} prompt_chars=${promptChars} ` +
          `usage=${JSON.stringify(response?.usage)}`,
        );
      }
      responseText = trimmed || `Sorry, the model (${model}) returned an empty response. This may indicate rate limiting or a service issue.`;
      break;
    }

    // Process tool calls
    messages.push(msg);

    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, unknown>;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: 'Invalid JSON arguments' }) });
        continue;
      }

      onToolProgress?.({ tool: fnName, args: fnArgs, status: 'running' });
      onProgress?.(`${fnName}: running\n`);

      let toolResult: any;

      // Handle meta-tools
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
        // Inject the new tool into activeTools so it's callable this conversation
        if (toolResult.success) {
          const newToolName = fnArgs.name as string;
          const newToolset = fnArgs.toolset as string;
          const newDefs = getToolsetDefinitions(newToolset).filter(d => d.function.name === newToolName);
          activeTools.push(...newDefs);
          activatedToolsets.add(newToolset);
        }
      } else if (fnName === 'list_custom_tools') {
        toolResult = await handleListCustomTools();
      } else if (fnName === 'delete_tool') {
        toolResult = await handleDeleteTool(fnArgs);
        // If the deleted tool was in activeTools, drop it so the model can't
        // try to call it later in this conversation.
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
        console.log(`[followup-auto] Tool=${fnName} convId=${options.conversationId} success=${toolResult?.success} taskId=${taskId}`);
        if (options.conversationId && toolResult?.success && taskId) {
          const autoConfig = autoFollowUpTools[fnName];
          const checkFn = buildCheckFn(autoConfig.type, taskId);
          if (checkFn) {
            enqueueFollowUp({
              conversationId: options.conversationId,
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
      onToolProgress?.({ tool: fnName, args: fnArgs, result: progressResult, status: toolResult?.error ? 'error' : 'done' });
      onProgress?.(`${fnName}: done\n`);
      // Truncate large tool results to avoid overwhelming the LLM context
      let resultStr = JSON.stringify(toolResult);
      if (resultStr.length > 8000) {
        resultStr = resultStr.slice(0, 8000) + '... [truncated — result too large for chat context]';
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultStr,
      });
    }
  }

  if (!responseText) {
    responseText = `Sorry, the model (${model}) did not produce a final response after ${MAX_TOOL_ROUNDS} tool rounds.`;
  }

  return { response: responseText };
}
