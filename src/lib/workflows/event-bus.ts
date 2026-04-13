import { EventEmitter } from 'events';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowRuns, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';

export type PlatformEventType =
  | 'strava_activity_synced'
  | 'whoop_recovery_updated'
  | 'workflow_completed';

export interface PlatformEvent {
  type: PlatformEventType;
  payload?: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emit(type: PlatformEventType, payload?: Record<string, unknown>): void {
  emitter.emit(type, { type, payload });
}

export function on(
  type: PlatformEventType,
  handler: (event: PlatformEvent) => void
): () => void {
  emitter.on(type, handler);
  return () => emitter.off(type, handler);
}

// Internal: start any event-triggered workflows matching this event type
async function handlePlatformEvent(event: PlatformEvent): Promise<void> {
  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'event'), eq(workflowSchedules.enabled, true)));

  const matching = schedules.filter((s) => {
    const config = s.config as Record<string, unknown>;
    return config.eventType === event.type;
  });

  for (const schedule of matching) {
    const [wf] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, schedule.workflowId))
      .limit(1);
    if (!wf) continue;

    const runId = crypto.randomUUID();
    const now = new Date();

    await db.insert(workflowRuns).values({
      id: runId,
      workflowId: schedule.workflowId,
      status: 'running',
      trigger: 'event',
      startedAt: now,
    });

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, schedule.workflowId));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, schedule.workflowId));

    const def = {
      id: schedule.workflowId,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        label: n.label ?? n.type,
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    };

    engine
      .execute(def, runId, { event: event.payload ?? {} }, undefined, schedule.workflowId)
      .then(async (result) => {
        await db
          .update(workflowRuns)
          .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
          .where(eq(workflowRuns.id, runId));
      })
      .catch(console.error);
  }
}

// Register global listeners
(['strava_activity_synced', 'whoop_recovery_updated', 'workflow_completed'] as PlatformEventType[])
  .forEach((type) => emitter.on(type, handlePlatformEvent));
