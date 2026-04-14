import { db } from '$lib/db';
import { homeAssistantConfig, orchestratorChats } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { HA_TOOL_DEFINITIONS, buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';
import { SITE_TOOL_DEFINITIONS, buildSiteSystemPromptSection } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';

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

  // Load HA entity context
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

  // Build system prompt
  const basePrompt = await getCompiledPrompt();
  const haSection = buildHASystemPromptSection(haEntities);
  const siteSection = buildSiteSystemPromptSection();
  const systemContent = `${basePrompt}${haSection}${siteSection}`;

  // Build messages
  const messages: Array<any> = [
    { role: 'system', content: systemContent },
  ];

  const recentHistory = conversationHistory.slice(-MAX_HISTORY);
  for (const h of recentHistory) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // Call LLM with tools
  const client = getOpenAIClient();
  const model = getModel();
  const allTools = [...(haEntities.length > 0 ? HA_TOOL_DEFINITIONS : []), ...SITE_TOOL_DEFINITIONS];
  const tools = allTools.length > 0 ? allTools : undefined;

  let responseText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 1024,
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
    if (!choice) break;

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
          if (fnName.startsWith('site_') || fnName.startsWith('jkai_') || fnName.startsWith('research_')) {
            toolResult = await executeSiteTool(fnName, fnArgs);
          } else {
            toolResult = { error: `Unknown function: ${fnName}` };
          }
      }

      onProgress?.(`${fnName}: done\n`);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  if (!responseText) {
    responseText = "Sorry, I couldn't generate a response.";
  }

  return { response: responseText };
}
