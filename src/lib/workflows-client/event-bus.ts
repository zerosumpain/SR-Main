import { db } from '$lib/db';
import { workflowSchedules } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { onAll, type PlatformEvent } from '$lib/events/platform-bus';
import { scheduleMatchesEvent } from '$lib/events/filter';
import { markDispatched } from '$lib/events/store';
import { startTriggeredRun } from './start-run';

/**
 * The dispatch half of the platform event channel: turn an event into workflow
 * runs. Publishing lives in `$lib/events/platform-bus` (so a publisher never
 * imports the engine), what an event IS lives in `$lib/events/catalogue`, and
 * which schedules match — type, pinned source workflow, payload filter, and the
 * never-trigger-yourself rule — is the pure `scheduleMatchesEvent`.
 *
 * Runs start through `startTriggeredRun`, the same path the whatsapp and gmail
 * bridges use, and settle through `finaliseRun` like every other run.
 *
 * emit/on are re-exported so existing callers keep working; new publishers should
 * import from `$lib/events/platform-bus` directly and stay cheap.
 */
export type { PlatformEvent, PlatformEventType } from '$lib/events/platform-bus';
export { emit, on } from '$lib/events/platform-bus';

/**
 * How many event→run hops one chain may take. Every run emits
 * `workflow.completed`, and a notify inside a run emits `notification.raised`,
 * so A→B→A pinned to each other would otherwise loop forever.
 */
export const MAX_CHAIN_DEPTH = 5;

export async function handlePlatformEvent(event: PlatformEvent): Promise<void> {
  const depth = event.chainDepth ?? 0;
  if (depth >= MAX_CHAIN_DEPTH) {
    console.warn(`[event-bus] ${event.type} chain reached depth ${depth} — not starting further workflows`);
    return;
  }

  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'event'), eq(workflowSchedules.enabled, true)));

  const matchable = { ...event, chainDepth: depth, originWorkflowId: event.originWorkflowId ?? null };
  for (const schedule of schedules) {
    if (!scheduleMatchesEvent((schedule.config ?? {}) as Record<string, unknown>, schedule.workflowId, matchable)) continue;
    try {
      await startTriggeredRun(
        schedule.workflowId,
        { event: event.payload ?? {}, eventType: event.type, eventId: event.id ?? null },
        { label: 'event-bus', chainDepth: depth + 1 },
      );
    } catch (err) {
      console.error(`[event-bus] could not start ${schedule.workflowId} on ${event.type}:`, err instanceof Error ? err.message : err);
    }
  }

  // Stamp once the row exists — the write races delivery, so wait for it.
  if (event.id && (await event.persisted)) await markDispatched(event.id);
}

// Register global listeners. This is a module side effect: importing this file is
// what makes event-triggered workflows fire at all. hooks.server.ts reaches it via
// $lib/jkai/workflow-deliveries, which imports `on` from here.
onAll((event) => {
  handlePlatformEvent(event).catch((err) =>
    console.error(`[event-bus] dispatch of ${event.type} failed:`, err instanceof Error ? err.message : err),
  );
});
