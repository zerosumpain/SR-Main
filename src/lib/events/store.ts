/**
 * The durable half of the platform bus: `platform_events`.
 *
 * Loaded lazily by `platform-bus.ts`, so publishing an event still costs the
 * publisher nothing at import time — only the first emit pays for the database
 * module, and every process that emits already has it loaded.
 *
 * Nothing here throws. An event whose row could not be written is still
 * delivered in-process; the log is a record of the bus, never a gate on it.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { platformEvents } from '$lib/db/schema';

export const PLATFORM_EVENT_RETENTION_DAYS = 30;

export interface StoredEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source: string | null;
  chainDepth: number;
  originWorkflowId: string | null;
}

export async function recordPlatformEvent(event: StoredEvent): Promise<boolean> {
  try {
    await db.insert(platformEvents).values({
      id: event.id,
      type: event.type,
      payload: event.payload,
      source: event.source,
      chainDepth: event.chainDepth,
      originWorkflowId: event.originWorkflowId,
    });
    return true;
  } catch (err) {
    console.error(`[platform-events] could not record ${event.type}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function markDispatched(id: string): Promise<void> {
  try {
    await db.update(platformEvents).set({ dispatchedAt: new Date() }).where(eq(platformEvents.id, id));
  } catch (err) {
    console.error('[platform-events] could not stamp dispatch:', err instanceof Error ? err.message : err);
  }
}

/**
 * Delete rows past retention. Bounded per call, like `prunePulses`, so a first
 * run against a large table takes a few ticks rather than one long transaction.
 */
export async function prunePlatformEvents(limit = 20_000): Promise<number> {
  try {
    const res = await db.execute(sql`
      DELETE FROM platform_events
      WHERE id IN (
        SELECT id FROM platform_events
        WHERE created_at < now() - (${PLATFORM_EVENT_RETENTION_DAYS} || ' days')::interval
        ORDER BY created_at
        LIMIT ${limit}
      )
    `);
    const n = (res as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n > 0) console.log(`[platform-events] pruned ${n} rows older than ${PLATFORM_EVENT_RETENTION_DAYS} days`);
    return n;
  } catch (err) {
    console.error('[platform-events] prune failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}
