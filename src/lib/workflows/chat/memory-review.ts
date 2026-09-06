import { writeMemory, backfillMemoryEmbeddings } from '$lib/jkai/memory/service.server';
// src/lib/workflows/chat/memory-review.ts

import { db } from '$lib/db';
import { conversations, orchestratorChats, jkaiMemories } from '$lib/db/schema';
import { eq, and, isNull, lt, desc, gt, or } from 'drizzle-orm';
import { getLLMClient } from '$lib/llm/client';
import { resolveChatMaintenanceModel } from '$lib/server/models/workload-settings';
import { currentSessionModel } from '$lib/context/chat';
import { withActivity } from '$lib/context/activity';

const REVIEW_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // conversation idle for 30 min

const EXTRACTION_PROMPT = `Review this conversation and extract facts worth remembering about the user.

Categories: people, preferences, places, health, devices, situations

Rules:
- Only extract facts useful in future conversations
- Do not extract ephemeral task details ("user asked to turn on lights")
- Do not extract sensitive data (passwords, financial details)
- Assign confidence: "high" if explicitly stated, "medium" if inferred
- Never treat quoted source prose or assistant claims as user facts. Do not infer residence from a visit.
- Return updates as null; corrections require explicit memory identity, never text overlap.

Existing memories (avoid duplicates):
{EXISTING_MEMORIES}

Return a JSON array (no markdown, no code fences):
[{ "category": "...", "content": "...", "confidence": "high|medium", "updates": "content of memory it replaces, or null" }]

Return an empty array [] if nothing is worth remembering.`;

/**
 * `strict` is for the on-demand path (the inspector's "review now"): the
 * background sweep wants a failure to score zero and move on to the next
 * conversation, but a person who pressed the button must not be told
 * "nothing new to remember" because the gateway was down.
 */
export async function reviewConversation(conversationId: string, opts: { strict?: boolean } = {}): Promise<number> {
  const fail = (message: string): number => {
    if (opts.strict) throw new Error(message);
    return 0;
  };
  // Get the conversation
  const [conv] = await db.select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return fail('No such conversation');

  // Get messages since last review
  const conditions = [eq(orchestratorChats.conversationId, conversationId)];
  if (conv.lastMemoryReview) {
    conditions.push(gt(orchestratorChats.createdAt, conv.lastMemoryReview));
  }

  const messages = await db.select()
    .from(orchestratorChats)
    .where(and(...conditions))
    .orderBy(orchestratorChats.createdAt);

  if (messages.length === 0) {
    // No new messages — just update the marker
    await db.update(conversations)
      .set({ lastMemoryReview: new Date() })
      .where(eq(conversations.id, conversationId));
    return 0;
  }

  // Build conversation text for extraction
  const conversationText = messages
    .filter(m => m.role === 'user')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  // Load existing memories for dedup context
  const existingMemories = await db.select()
    .from(jkaiMemories)
    .where(isNull(jkaiMemories.supersededBy));

  const existingText = existingMemories.length > 0
    ? existingMemories.map(m => `[${m.category}] ${m.content}`).join('\n')
    : '(none)';

  const prompt = EXTRACTION_PROMPT.replace('{EXISTING_MEMORIES}', existingText);

  // Call LLM for extraction
  const { client, model } = await getLLMClient(
    currentSessionModel() ?? (await resolveChatMaintenanceModel()),
  );

  let response;
  try {
    response = await withActivity('chat-maintenance', () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: conversationText },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    );
  } catch (err) {
    console.error(`[memory-review] LLM call failed for conversation ${conversationId}:`, err instanceof Error ? err.message : err);
    return fail(`The extraction model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const raw = response.choices[0]?.message?.content?.trim() || '[]';
  let extractions: Array<{ category: string; content: string; confidence: string; updates: string | null }>;
  try {
    extractions = JSON.parse(raw);
  } catch {
    console.warn(`[memory-review] Failed to parse LLM output for conversation ${conversationId}:`, raw.slice(0, 200));
    return fail('The extraction model returned something that was not a list of facts');
  }

  if (!Array.isArray(extractions) || extractions.length === 0) {
    await db.update(conversations)
      .set({ lastMemoryReview: new Date() })
      .where(eq(conversations.id, conversationId));
    return 0;
  }

  let saved = 0;
  for (const ext of extractions) {
    if (!ext.category || !ext.content) continue;

    const row = await writeMemory({ category: ext.category, content: ext.content,
      confidence: ext.confidence, sourceConversationId: conversationId,
      provenance: { origin: 'extraction', sourceId: conversationId, assertion: 'inferred' },
    });
    if (row.stored) saved++;

  }

  // Update the review marker
  await db.update(conversations)
    .set({ lastMemoryReview: messages[messages.length - 1].createdAt })
    .where(eq(conversations.id, conversationId));

  if (saved > 0) {
    console.log(`[memory-review] Extracted ${saved} memory/memories from conversation ${conversationId}`);
  }

  return saved;
}

async function runMemoryReview(): Promise<void> {
  const { backfillMemoryLinks } = await import('$lib/jkai/memory/graph.server');
  await backfillMemoryLinks().catch(err => console.warn('[memory] link backfill failed', err instanceof Error ? err.message : err));
  await backfillMemoryEmbeddings().catch(() => {});
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  try {
    const allConvs = await db.select({ id: conversations.id, lastMemoryReview: conversations.lastMemoryReview })
      .from(conversations);

    for (const conv of allConvs) {
      // Get the latest message timestamp
      const [latest] = await db.select({ createdAt: orchestratorChats.createdAt })
        .from(orchestratorChats)
        .where(eq(orchestratorChats.conversationId, conv.id))
        .orderBy(desc(orchestratorChats.createdAt))
        .limit(1);

      if (!latest) continue;

      // Skip if conversation is still active (last message is recent)
      if (latest.createdAt > staleThreshold) continue;

      // Skip if already reviewed after the latest message
      if (conv.lastMemoryReview && conv.lastMemoryReview >= latest.createdAt) continue;

      await reviewConversation(conv.id);
    }
  } catch (err) {
    console.error('[memory-review] Review sweep failed:', err instanceof Error ? err.message : err);
  }
}

let reviewInterval: ReturnType<typeof setInterval> | null = null;

export function startMemoryReview(): void {
  if (reviewInterval) return;
  reviewInterval = setInterval(runMemoryReview, REVIEW_INTERVAL_MS);
  console.log('[memory-review] Background review started (every 30 min)');
  // Run once on startup after a short delay
  setTimeout(runMemoryReview, 10_000);
}

export function stopMemoryReview(): void {
  if (reviewInterval) {
    clearInterval(reviewInterval);
    reviewInterval = null;
  }
}
