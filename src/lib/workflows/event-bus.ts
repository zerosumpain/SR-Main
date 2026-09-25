import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowRuns, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import { onAll, type PlatformEvent } from '$lib/events/platform-bus';
import { finaliseRun, failRun } from './run-finalise';

/**
 * The dispatch half of the platform event channel: turn an event into a workflow
 * run. The emitter itself moved to `$lib/events/platform-bus`, because importing
 * `engine` from the workflows barrel to PUBLISH an event dragged the whole node
 * registry into every publisher's import closure.
 *
 * emit/on are re-exported so existing callers keep working; new publishers should
 * import from `$lib/events/platform-bus` directly and stay cheap.
 */
export type { PlatformEvent, PlatformEventType } from '$lib/events/platform-bus';
export { emit, on } from '$lib/events/platform-bus';

/**
 * How many `workflow_completed` hops one chain may take. Every run now emits
 * `workflow_completed` — event-started ones included — so A→B→A pinned to each
 * other would otherwise loop forever. The depth rides on the event payload.
 */
export const MAX_CHAIN_DEPTH = 5;

function chainDepthOf(event: PlatformEvent): number {
  const d = Number((event.payload as Record<string, unknown> | undefined)?.chainDepth ?? 0);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

// Internal: start any event-triggered workflows matching this event type
export async function handlePlatformEvent(event: PlatformEvent): Promise<void> {
  const depth = chainDepthOf(event);
  if (event.type === 'workflow_completed' && depth >= MAX_CHAIN_DEPTH) {
    console.warn(`[event-bus] workflow_completed chain reached depth ${depth} — not starting further workflows`);
    return;
  }

  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'event'), eq(workflowSchedules.enabled, true)));

  const matching = schedules.filter((s) => {
    const config = s.config as Record<string, unknown>;
    if (config.eventType !== event.type) return false;
    // If a specific source workflow is pinned, only fire on that one.
    const sourceWorkflowId = config.sourceWorkflowId as string | undefined;
    if (sourceWorkflowId) {
      const payloadWfId = (event.payload as Record<string, unknown> | undefined)?.workflowId;
      if (payloadWfId !== sourceWorkflowId) return false;
    }
    // A workflow never triggers itself off its own completion: an unpinned
    // workflow_completed trigger would otherwise re-run it forever.
    if (event.type === 'workflow_completed') {
      const payloadWfId = (event.payload as Record<string, unknown> | undefined)?.workflowId;
      if (payloadWfId === s.workflowId) return false;
    }
    return true;
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
      name: wf.name,
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

    const runStartedAt = now.getTime();
    engine
      .execute(def, runId, { event: event.payload ?? {} }, undefined, schedule.workflowId)
      .then((result) =>
        finaliseRun({
          workflowId: schedule.workflowId,
          runId,
          result,
          runStartedAt,
          chainDepth: event.type === 'workflow_completed' ? depth + 1 : undefined,
          label: 'event-bus',
        }),
      )
      .catch((err) => failRun({ workflowId: schedule.workflowId, runId, error: err, label: 'event-bus' }));
  }
}

// Register global listeners. This is a module side effect: importing this file is
// what makes event-triggered workflows fire at all. hooks.server.ts reaches it via
// $lib/jkai/workflow-deliveries, which imports `on` from here.
onAll(handlePlatformEvent);
