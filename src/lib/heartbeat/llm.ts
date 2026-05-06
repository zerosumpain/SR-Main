import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';

export interface RunHeartbeatTurnOpts {
  conversationId: string;
  userText: string;
  maxTokens?: number;
  model?: ModelContext;
  activityName: string;
  instruction: string;
  /**
   * If true, the LLM gets the system-toolset tool defs and may call them.
   * Used by orchestrator-turn callbacks (where the agent might need to
   * actually do something, e.g. turn off lights). Off for cheap watcher
   * pulses. Up to 3 rounds of tool calling are supported.
   */
  toolsEnabled?: boolean;
}

export interface HeartbeatTurnResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
  messageId: string;
  /** Names of any tools the LLM called during this turn. */
  toolsCalled: string[];
}

/**
 * Run a single LLM turn in the context of an existing conversation, on
 * behalf of the heartbeat engine. Persists both the synthetic user message
 * and the assistant reply with metadata.heartbeat so the UI can style them.
 *
 * Designed for short, focused turns (continuations, nudges, micro-summaries).
 * Not a substitute for the full general-chat pipeline — no tools, no plan
 * phase, no follow-up queue, no streaming. Cheaper and predictable.
 */
const MAX_TOOL_ROUNDS = 3;

export async function runHeartbeatTurn(opts: RunHeartbeatTurnOpts): Promise<HeartbeatTurnResult> {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, opts.conversationId)).limit(1);
  if (!conv) throw new Error(`conversation ${opts.conversationId} not found`);

  const ctx = opts.model ?? (
    conv.modelProvider && conv.modelId
      ? { provider: conv.modelProvider as 'zai' | 'openrouter', modelId: conv.modelId }
      : await resolveDefaultModel('chat')
  );
  const { client, model } = await getLLMClient(ctx);

  const history = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, opts.conversationId))
    .orderBy(asc(orchestratorChats.createdAt))
    .limit(40);

  const messages: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content:
        'You are a heartbeat-driven assistant continuing an existing conversation. ' +
        'Be concise (≤120 words). If you can make progress autonomously, do so and report what changed. ' +
        'If you genuinely need user input you do not have, prefix your reply with NEEDS-USER: and ask. ' +
        opts.instruction,
    },
    ...history.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: opts.userText },
  ];

  // Persist the synthetic user message before the call so the conversation
  // ordering is correct even if the LLM call fails.
  const [userMsg] = await db
    .insert(orchestratorChats)
    .values({
      conversationId: opts.conversationId,
      role: 'user',
      content: opts.userText,
      metadata: { heartbeat: { activity: opts.activityName, kind: 'user-trigger' } },
    })
    .returning({ id: orchestratorChats.id });

  // Optional tool surface. The system toolset (heartbeat, scheduled,
  // followup tools) is always available when toolsEnabled=true. Only one
  // toolset is loaded — heartbeat agent turns shouldn't go on a tool
  // shopping spree; they should act tightly on what was asked.
  let toolDefs: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> | undefined;
  let toolsCalled: string[] = [];
  if (opts.toolsEnabled) {
    const { getToolsetDefinitions } = await import('$lib/workflows/site-tools/llm-tools');
    toolDefs = getToolsetDefinitions('system');
    // Add 'home' if the conversation context already references it. The
    // heartbeat shouldn't auto-load arbitrary toolsets, but home + system
    // covers the bulk of "do X at time Y" cases (lights, scenes, etc.).
    try {
      const homeDefs = getToolsetDefinitions('home');
      toolDefs = [...toolDefs, ...homeDefs];
    } catch { /* home toolset may not exist in dev */ }
  }

  let promptTokens = 0;
  let completionTokens = 0;
  let finalReply = '';

  for (let round = 0; round < (opts.toolsEnabled ? MAX_TOOL_ROUNDS : 1); round++) {
    const response = await client.chat.completions.create({
      model,
      messages: messages as any,
      temperature: 0.5,
      max_tokens: opts.maxTokens ?? 600,
      ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs as any } : {}),
    });

    promptTokens += response.usage?.prompt_tokens ?? 0;
    completionTokens += response.usage?.completion_tokens ?? 0;

    const choice = response.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    const toolCalls = (msg as { tool_calls?: Array<{ id: string; function?: { name: string; arguments: string } }> }).tool_calls;
    if (toolCalls && toolCalls.length > 0 && opts.toolsEnabled) {
      // Push the assistant message with tool_calls and execute each.
      messages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: toolCalls,
      });
      const { executeSiteTool, isRegisteredTool } = await import('$lib/workflows/site-tools/executor');
      for (const tc of toolCalls) {
        const fnName = tc.function?.name ?? '';
        toolsCalled.push(fnName);
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /* keep empty */ }
        let result: unknown = { error: 'tool not registered' };
        if (isRegisteredTool(fnName)) {
          result = await executeSiteTool(fnName, parsed, { emit: () => {}, conversationId: opts.conversationId });
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      continue; // next round — let the LLM produce a final summary
    }

    finalReply = (msg.content ?? '').trim();
    break;
  }

  const [asstMsg] = await db
    .insert(orchestratorChats)
    .values({
      conversationId: opts.conversationId,
      role: 'assistant',
      content: finalReply || '(empty heartbeat reply)',
      metadata: {
        heartbeat: {
          activity: opts.activityName,
          kind: 'reply',
          replyToHeartbeatMessageId: userMsg.id,
          tokens: { prompt: promptTokens, completion: completionTokens },
          toolsCalled: toolsCalled.length > 0 ? toolsCalled : undefined,
        },
      },
    })
    .returning({ id: orchestratorChats.id });

  return { reply: finalReply, promptTokens, completionTokens, messageId: asstMsg.id, toolsCalled };
}

/**
 * Insert a system-style note into a conversation without calling the LLM.
 * Used for cheap "still working" / "paused N min ago" status nudges that
 * don't justify an LLM round.
 */
export async function postHeartbeatNote(opts: {
  conversationId: string;
  text: string;
  activityName: string;
}): Promise<{ messageId: string }> {
  const [row] = await db
    .insert(orchestratorChats)
    .values({
      conversationId: opts.conversationId,
      role: 'assistant',
      content: opts.text,
      metadata: { heartbeat: { activity: opts.activityName, kind: 'note' } },
    })
    .returning({ id: orchestratorChats.id });
  return { messageId: row.id };
}
