// src/lib/workflows/chat/memory-review.ts

import { db } from '$lib/db';
import { conversations, orchestratorChats, jkaiMemories } from '$lib/db/schema';
import { eq, and, isNull, lt, desc, gt, or } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';

const REVIEW_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // conversation idle for 30 min

const EXTRACTION_PROMPT = `Review this conversation and extract facts worth remembering about the user.

Categories: people, preferences, places, health, devices, situations

Rules:
- Only extract facts useful in future conversations
- Do not extract ephemeral task details ("user asked to turn on lights")
- Do not extract sensitive data (passwords, financial details)
- Assign confidence: "high" if explicitly stated, "medium" if inferred
- If a fact updates something already in memory, set "updates" to the old memory content it replaces

Existing memories (avoid duplicates):
{EXISTING_MEMORIES}

Return a JSON array (no markdown, no code fences):
[{ "category": "...", "content": "...", "confidence": "high|medium", "updates": "content of memory it replaces, or null" }]

Return an empty array [] if nothing is worth remembering.`;

async function reviewConversation(conversationId: string): Promise<number> {
  // Get the conversation
  const [conv] = await db.select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return 0;

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
  const client = getOpenAIClient();
  const model = getModel();

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: conversationText },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });
  } catch (err) {
    console.error(`[memory-review] LLM call failed for conversation ${conversationId}:`, err instanceof Error ? err.message : err);
    return 0;
  }

  const raw = response.choices[0]?.message?.content?.trim() || '[]';
  let extractions: Array<{ category: string; content: string; confidence: string; updates: string | null }>;
  try {
    extractions = JSON.parse(raw);
  } catch {
    console.warn(`[memory-review] Failed to parse LLM output for conversation ${conversationId}:`, raw.slice(0, 200));
    // Update marker even on parse failure to avoid retrying the same messages
    await db.update(conversations)
      .set({ lastMemoryReview: new Date() })
      .where(eq(conversations.id, conversationId));
    return 0;
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

    const newId = crypto.randomUUID();

    // If this updates an existing memory, supersede it
    if (ext.updates) {
      const match = existingMemories.find(m =>
        m.content.toLowerCase().includes(ext.updates!.toLowerCase().slice(0, 50))
        || ext.updates!.toLowerCase().includes(m.content.toLowerCase().slice(0, 50))
      );
      if (match) {
        await db.update(jkaiMemories)
          .set({ supersededBy: newId, updatedAt: new Date() })
          .where(eq(jkaiMemories.id, match.id));
      }
    }

    await db.insert(jkaiMemories).values({
      id: newId,
      category: ext.category,
      content: ext.content,
      sourceConversationId: conversationId,
      confidence: ext.confidence === 'medium' ? 'medium' : 'high',
    });
    saved++;
  }

  // Update the review marker
  await db.update(conversations)
    .set({ lastMemoryReview: new Date() })
    .where(eq(conversations.id, conversationId));

  if (saved > 0) {
    console.log(`[memory-review] Extracted ${saved} memory/memories from conversation ${conversationId}`);
  }

  return saved;
}

async function runMemoryReview(): Promise<void> {
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
