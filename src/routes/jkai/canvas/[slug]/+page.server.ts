import type { PageServerLoad } from './$types';
import {
  loadCanvas,
  loadModelCatalogue,
  listCanvases,
  reapExpiredInteractions,
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
  const [canvas, modelCatalogue, allCanvases] = await Promise.all([
    loadCanvas(params.slug),
    loadModelCatalogue(),
    listCanvases(),
  ]);

  // Reap any zombie `awaiting_human` runs for this canvas AFTER loading it
  // (so we use the workflowId already looked up instead of triggering a
  // side-effecting `ensureCanvasWorkflow` that would silently seed a blank
  // canvas for any slug that doesn't exist). Fire-and-forget so page load
  // time isn't paid by the user — the next refresh picks up the reaped state.
  if (canvas?.workflowId) {
    void reapExpiredInteractions(canvas.workflowId).catch((err) => {
      console.error('[canvas] reapExpiredInteractions failed', err);
    });
  }

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
