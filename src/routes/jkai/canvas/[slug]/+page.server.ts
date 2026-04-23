import type { PageServerLoad } from './$types';
import {
  loadCanvas,
  loadModelCatalogue,
  listCanvases,
  reapExpiredInteractions,
  ensureCanvasWorkflow,
} from '$lib/canvas/adapter.server';
import { CANVAS_NODE_TYPES } from '$lib/canvas/adapter';
import { db } from '$lib/db';
import { intelExplorations } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

export type {
  NodeKind,
  NodeStatus,
  CanvasNode,
  CanvasEdge,
  Canvas,
  ChatMessage,
  ModelCatalogue,
  ModelOption,
  NodeTypeOption,
  CanvasSummary,
} from '$lib/canvas/adapter';

export const load: PageServerLoad = async ({ params }) => {
  // Reap any zombie `awaiting_human` runs for this canvas BEFORE loading it,
  // so the loaded snapshot sees the post-reap state (no stale latestRun
  // pointing at an abandoned interactive step).
  try {
    const { workflowId } = await ensureCanvasWorkflow(params.slug);
    await reapExpiredInteractions(workflowId);
  } catch (err) {
    console.error('[canvas] reapExpiredInteractions failed', err);
  }

  const [canvas, modelCatalogue, allCanvases] = await Promise.all([
    loadCanvas(params.slug),
    loadModelCatalogue(),
    listCanvases(),
  ]);
  // Strip this canvas from the peers list (used by the event-trigger picker)
  const peerCanvases = allCanvases.filter((c) => c.workflowId !== canvas.workflowId);

  const activeExplorations = await db
    .select({
      nodeId: intelExplorations.nodeId,
      engine: intelExplorations.engine,
      sessionId: intelExplorations.sessionId,
      status: intelExplorations.status,
    })
    .from(intelExplorations)
    .where(
      and(
        eq(intelExplorations.workflowId, canvas.workflowId),
        inArray(intelExplorations.status, ['running', 'failed']),
      ),
    );

  const pendingExplorations = Object.fromEntries(
    activeExplorations.map((e) => [
      e.nodeId,
      {
        engine: e.engine as 'deep' | 'quick',
        sessionId: e.sessionId,
        status: e.status as 'running' | 'failed',
        streamUrl:
          e.engine === 'deep'
            ? `/api/deepdive/${e.sessionId}/stream`
            : `/quickanswer/${e.sessionId}/stream`,
      },
    ]),
  );

  return { canvas, modelCatalogue, nodeTypes: CANVAS_NODE_TYPES, peerCanvases, pendingExplorations };
};
