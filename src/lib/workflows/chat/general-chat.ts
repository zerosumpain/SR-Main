// src/lib/workflows/chat/general-chat.ts — full replacement

import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { HA_TOOL_DEFINITIONS, buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';
import { META_TOOL_DEFINITIONS, getToolsetDefinitions } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool, isRegisteredTool } from '$lib/workflows/site-tools/executor';
import { handleJkaiHelp } from '$lib/workflows/site-tools/meta-tools';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';
import { buildSystemPromptSection } from '$lib/workflows/site-tools/registry';

const MAX_HISTORY = 30;
const MAX_TOOL_ROUNDS = 5;

interface ChatOptions {
  workflowId?: string | null;
  onProgress?: (text: string) => void;
}

export async function generalChat(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  options: ChatOptions = {},
): Promise<{ response: string }> {
  const { onProgress } = options;

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
  } catch {}

  // Build system prompt — no longer includes HA entity registry or full tool list
  const basePrompt = await getCompiledPrompt();
  const siteSection = buildSystemPromptSection();
  const systemContent = `${basePrompt}${siteSection}`;

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
    if (ts === 'home') {
      // For home toolset, also add HA tools if entities are available
      if (haEntities.length > 0) {
        activeTools.push(...HA_TOOL_DEFINITIONS);
        activatedToolsets.add('home');
      }
    } else {
      activeTools.push(...getToolsetDefinitions(ts));
      activatedToolsets.add(ts);
    }
  }

  const client = getOpenAIClient();
  const model = getModel();
  let responseText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const tools = activeTools.length > 0 ? activeTools : undefined;

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
          ...(tools ? { tools } : {}),
        });
        break;
      } catch (err: any) {
        if (err?.status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
          continue;
        }
        throw err;
      }
    }

    const choice = response?.choices[0];
    if (!choice) {
      console.warn('[general-chat] No choice in LLM response');
      break;
    }

    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      responseText = msg.content?.trim() || "Sorry, I couldn't generate a response.";
      break;
    }

    // Process tool calls
    messages.push(msg);
    onProgress?.(`Using tools...\n`);

    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs: Record<string, unknown>;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: 'Invalid JSON arguments' }) });
        continue;
      }

      let toolResult: any;

      // Handle meta-tools
      if (fnName === 'activate_toolset') {
        const toolset = fnArgs.toolset as string;
        if (activatedToolsets.has(toolset)) {
          toolResult = { success: true, data: { toolset, status: 'already_active', message: `${toolset} tools are already loaded.` } };
        } else if (toolset === 'home') {
          if (haEntities.length > 0) {
            activeTools.push(...HA_TOOL_DEFINITIONS);
            activatedToolsets.add('home');
            const entitySummary = buildHASystemPromptSection(haEntities);
            toolResult = {
              success: true,
              data: {
                toolset: 'home',
                status: 'activated',
                tools: HA_TOOL_DEFINITIONS.map((t) => t.function.name),
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
      } else {
        // Handle HA tools
        const haService = getHomeAssistantService();
        switch (fnName) {
          case 'ha_query_state':
            toolResult = await haService.queryState(fnArgs.entity_id as string);
            break;
          case 'ha_call_service':
            toolResult = await haService.callService(
              fnArgs.domain as string,
              fnArgs.service as string,
              fnArgs.entity_id as string | undefined,
              fnArgs.data as Record<string, unknown> | undefined,
            );
            break;
          case 'ha_fire_event':
            toolResult = await haService.fireEvent(
              fnArgs.event_type as string,
              fnArgs.data as Record<string, unknown> | undefined,
            );
            break;
          case 'ha_get_history':
            toolResult = await haService.getHistory(
              fnArgs.entity_id as string,
              fnArgs.start as string | undefined,
              fnArgs.end as string | undefined,
            );
            break;
          case 'ha_render_template':
            toolResult = await haService.renderTemplate(fnArgs.template as string);
            break;
          default:
            if (isRegisteredTool(fnName)) {
              toolResult = await executeSiteTool(fnName, fnArgs);
            } else {
              toolResult = { error: `Unknown function: ${fnName}` };
            }
        }
      }

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
    responseText = "Sorry, I couldn't generate a response.";
  }

  return { response: responseText };
}
