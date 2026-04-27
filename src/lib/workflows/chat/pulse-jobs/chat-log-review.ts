import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { NewPulseEvent } from '$lib/db/schema';

const WINDOW_MS = 6 * 60 * 60 * 1000;

const PROMPT = `Review the last 6 hours of orchestrator chat traffic. Identify recurring user friction patterns: repeated complaints, requests the orchestrator failed to fulfil, manual nudges the user had to provide. Output JSON ONLY: {"summary":"...","severity":"info","themes":[{"theme":"...","occurrences":N,"example":"..."}]}.

If no patterns are visible, summary should be "No recurring friction patterns observed."`;

export async function runChatLogReview(): Promise<NewPulseEvent[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db
    .select({
      role: orchestratorChats.role,
      content: orchestratorChats.content,
      at: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(gte(orchestratorChats.createdAt, since))
    .orderBy(desc(orchestratorChats.createdAt))
    .limit(400);

  if (rows.length === 0) {
    return [
      {
        kind: 'chat_log_review',
        severity: 'info',
        summary: 'No chat traffic in the last 6h.',
        details: { messageCount: 0 },
      } satisfies NewPulseEvent,
    ];
  }

  const trimmed = rows.slice(0, 200).map((r) => ({
    role: r.role,
    content: (r.content ?? '').slice(0, 400),
  }));

  try {
    const client = getOpenAIClient();
    const model = getModel();
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(trimmed) },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}') as {
      summary?: string;
      severity?: 'info';
      themes?: unknown[];
    };
    return [
      {
        kind: 'chat_log_review',
        severity: 'info',
        summary: (parsed.summary ?? 'Chat review unavailable').slice(0, 280),
        details: { ...parsed, messageCount: rows.length },
      } satisfies NewPulseEvent,
    ];
  } catch (e) {
    return [
      {
        kind: 'chat_log_review',
        severity: 'warn',
        summary: `Chat review LLM error: ${(e as Error).message.slice(0, 120)}`,
        details: { error: (e as Error).message },
      } satisfies NewPulseEvent,
    ];
  }
}
