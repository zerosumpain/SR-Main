import { db } from '$lib/db';
import { jkaiMemories, conversations } from '$lib/db/schema';
import { lt, desc, isNotNull } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { NewPulseEvent } from '$lib/db/schema';

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

const PROMPT = `Given a memory record and a sample of the most recent conversation context, decide if the memory may now be outdated, contradicted, or worth refining. Output JSON ONLY: {"verdict":"keep"|"flag","reason":"..."}.`;

export async function runMemoryUpdateReview(): Promise<NewPulseEvent[]> {
  const stale = await db
    .select()
    .from(jkaiMemories)
    .where(lt(jkaiMemories.updatedAt, new Date(Date.now() - STALE_MS)))
    .orderBy(desc(jkaiMemories.updatedAt))
    .limit(10);

  if (stale.length === 0) {
    return [
      {
        kind: 'memory_update_review',
        severity: 'info',
        summary: 'No stale memories to review.',
        details: { reviewed: 0 },
      } satisfies NewPulseEvent,
    ];
  }

  const [latestConv] = await db
    .select()
    .from(conversations)
    .where(isNotNull(conversations.updatedAt))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);

  const flagged: Array<{ memoryId: string; reason: string }> = [];
  const client = getOpenAIClient();
  const model = getModel();

  for (const mem of stale) {
    try {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              memory: {
                content: mem.content,
                category: mem.category,
                confidence: mem.confidence,
              },
              latestConvId: latestConv?.id ?? null,
            }),
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as {
        verdict?: 'keep' | 'flag';
        reason?: string;
      };
      if (parsed.verdict === 'flag') {
        flagged.push({ memoryId: mem.id, reason: parsed.reason ?? 'unspecified' });
      }
    } catch {
      /* skip on error */
    }
  }

  return [
    {
      kind: 'memory_update_review',
      severity: flagged.length > 0 ? 'warn' : 'info',
      summary:
        flagged.length > 0
          ? `${flagged.length} memory record(s) flagged for review.`
          : `Reviewed ${stale.length} stale memories; all OK.`,
      details: { reviewed: stale.length, flagged },
    } satisfies NewPulseEvent,
  ];
}
