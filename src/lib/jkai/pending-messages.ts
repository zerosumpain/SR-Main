/** Durable steering outbox. Inclusion is recorded only after Pi echoes the user message. */
import { db } from '$lib/db';
import { jkaiBuildPendingMessages, type JkaiBuildPendingMessage } from '$lib/db/schema';
import { and, asc, desc, eq, isNull, inArray } from 'drizzle-orm';
import { activePiWorker, instructionEnvelope } from './pi-rpc';

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
    .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), isNull(jkaiBuildPendingMessages.consumedAt), isNull(jkaiBuildPendingMessages.cancelledAt)))
    .orderBy(asc(jkaiBuildPendingMessages.createdAt));
}

export async function removePendingMessage(buildId: string, id: number): Promise<boolean> {
  const result = await db
    .update(jkaiBuildPendingMessages)
    .set({ cancelledAt: new Date() })
    .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), eq(jkaiBuildPendingMessages.id, id), isNull(jkaiBuildPendingMessages.dispatchedAt), isNull(jkaiBuildPendingMessages.acknowledgedAt), isNull(jkaiBuildPendingMessages.consumedAt), isNull(jkaiBuildPendingMessages.cancelledAt)))
    .returning();
  return result.length > 0;
}

export async function instructionHistory(buildId: string) {
  const rows = await db.select().from(jkaiBuildPendingMessages).where(eq(jkaiBuildPendingMessages.buildId, buildId))
    .orderBy(desc(jkaiBuildPendingMessages.id)).limit(200);
  return rows.reverse();
}

/** Only the echoed user message proves inclusion in the durable agent session. */
export async function markInstructionsApplied(buildId: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.update(jkaiBuildPendingMessages).set({ consumedAt: new Date() })
    .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), inArray(jkaiBuildPendingMessages.id, ids), isNull(jkaiBuildPendingMessages.consumedAt), isNull(jkaiBuildPendingMessages.cancelledAt)));
}

const delivering = new Set<string>();
export async function deliverPendingInstructions(buildId: string, sent: Set<number>): Promise<void> {
  const worker = activePiWorker(buildId);
  if (!worker || delivering.has(buildId)) return;
  delivering.add(buildId);
  try {
    for (const item of await listPendingMessages(buildId)) {
      if (sent.has(item.id)) continue;
      // Reserve before awaiting: a response failure is ambiguous. Reconcile from
      // Pi's persisted transcript on reconnection instead of sending twice here.
      sent.add(item.id);
      const reserved = await db.update(jkaiBuildPendingMessages).set({ dispatchedAt: new Date() })
        .where(and(eq(jkaiBuildPendingMessages.id, item.id), isNull(jkaiBuildPendingMessages.cancelledAt), isNull(jkaiBuildPendingMessages.consumedAt))).returning();
      if (!reserved.length) continue;
      await worker.request('steer', { message: instructionEnvelope(item.id, item.content) });
      await db.update(jkaiBuildPendingMessages).set({ acknowledgedAt: new Date() })
        .where(and(eq(jkaiBuildPendingMessages.buildId, buildId), eq(jkaiBuildPendingMessages.id, item.id)));
    }
  } finally { delivering.delete(buildId); }
}
