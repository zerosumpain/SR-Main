import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';

export interface RunHeartbeatTurnOpts {
  conversationId: string;
  /**
   * The prompt the heartbeat is delivering as if from the user. Will be
   * stored as a user-role message with metadata.heartbeat=true so the chat
   * UI can render it as a system-driven nudge.
   */
  userText: string;
  /** Soft cap for the assistant reply. Heartbeat replies should be short. */
  maxTokens?: number;
  /** Optional override; otherwise the conversation's pinned model is used. */
  model?: ModelContext;
  /** Tag used on both messages' metadata.heartbeat.activity. */
  activityName: string;
  /** System prompt suffix appended to a tight heartbeat preamble. */
  instruction: string;
}

export interface HeartbeatTurnResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
  /** ID of the assistant message just persisted. */
  messageId: string;
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

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content:
        'You are a heartbeat-driven assistant continuing an existing conversation. ' +
        'Be concise (≤120 words). If you can make progress autonomously, do so and report what changed. ' +
        'If you genuinely need user input you do not have, prefix your reply with NEEDS-USER: and ask. ' +
        opts.instruction,
    },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
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

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.5,
    max_tokens: opts.maxTokens ?? 600,
  });

  const reply = response.choices[0]?.message?.content?.trim() ?? '';
  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;

  const [asstMsg] = await db
    .insert(orchestratorChats)
    .values({
      conversationId: opts.conversationId,
      role: 'assistant',
      content: reply || '(empty heartbeat reply)',
      metadata: {
        heartbeat: {
          activity: opts.activityName,
          kind: 'reply',
          replyToHeartbeatMessageId: userMsg.id,
          tokens: { prompt: promptTokens, completion: completionTokens },
        },
      },
    })
    .returning({ id: orchestratorChats.id });

  return { reply, promptTokens, completionTokens, messageId: asstMsg.id };
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
