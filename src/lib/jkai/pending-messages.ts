/**
 * Pending-message queue helpers — Phase 5.
 *
 * The agent's iteration loop drains any unconsumed rows for a build at
 * the start of each LLM turn (drainPendingMessages), prepends them to
 * the system prompt as a `<user-injected>` block, then marks them
 * consumed. This is the user's "stop, do this instead" channel:
 * messages typed into /jkai/builds/<id>'s prompt land here.
 *
 * The DB table (jkai_build_pending_messages) is the source of truth so
 * messages survive process restarts of the builder.
 */
import { db } from '$lib/db';
import { jkaiBuildPendingMessages, type JkaiBuildPendingMessage } from '$lib/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';

export async function enqueuePendingMessage(
  buildId: string,
  content: string,
  role: 'user' | 'system' | 'shell-result' = 'user',
): Promise<JkaiBuildPendingMessage> {
  const [row] = await db
    .insert(jkaiBuildPendingMessages)
    .values({ buildId, content: content.trim(), role })
    .returning();
  return row;
}

export async function listPendingMessages(buildId: string): Promise<JkaiBuildPendingMessage[]> {
  return db
    .select()
    .from(jkaiBuildPendingMessages)
    .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), isNull(jkaiBuildPendingMessages.consumedAt)))
    .orderBy(asc(jkaiBuildPendingMessages.createdAt));
}

/** Drain the queue: return everything unconsumed for this build, mark
 *  consumed atomically. Called at the top of each LLM turn so the agent
 *  receives a stable snapshot. Concurrent inserts after the drain wait
 *  for the next turn — fine, we never lose messages.
 */
export async function drainPendingMessages(buildId: string): Promise<JkaiBuildPendingMessage[]> {
  const now = new Date();
  const drained = await db
    .update(jkaiBuildPendingMessages)
    .set({ consumedAt: now })
    .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), isNull(jkaiBuildPendingMessages.consumedAt)))
    .returning();
  return drained.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function removePendingMessage(buildId: string, id: number): Promise<boolean> {
  const result = await db
    .update(jkaiBuildPendingMessages)
    .set({ consumedAt: new Date() })
    .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), eq(jkaiBuildPendingMessages.id, id)))
    .returning();
  return result.length > 0;
}

/** Format a drained batch into the prompt block the agent sees. Empty
 *  string when there are no messages — caller can decide whether to skip
 *  the block. */
export function formatPendingForPrompt(messages: JkaiBuildPendingMessage[]): string {
  if (messages.length === 0) return '';
  const lines = messages.map((m) => {
    const ts = m.createdAt.toISOString().slice(11, 19); // HH:MM:SS
    return `[${ts} ${m.role}] ${m.content}`;
  });
  return [
    '<user-injected>',
    'The user typed these messages while you were working. Apply them now —',
    'they take precedence over earlier instructions where they conflict.',
    '',
    ...lines,
    '</user-injected>',
  ].join('\n');
}
