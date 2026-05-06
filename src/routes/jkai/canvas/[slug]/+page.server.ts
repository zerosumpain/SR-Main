import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
  loadCanvas,
  loadModelCatalogue,
  listCanvases,
  reapExpiredInteractions,
} from '$lib/canvas/adapter.server';
import { CANVAS_NODE_TYPES } from '$lib/canvas/adapter';
import { db } from '$lib/db';
import { intelExplorations, workflowNodes, conversations, workflows } from '$lib/db/schema';
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

export const load: PageServerLoad = async ({ params, url }) => {
  // Optional carry-through: `?conv=<id>` is appended by the /jkai chat hub
  // when the user follows a canvas link, so the conversation thread can
  // ride along onto the destination canvas's first chat node.
  const carryConvId = url.searchParams.get('conv');
  if (carryConvId) {
    try {
      await pinConversationToCanvasChat(params.slug, carryConvId);
    } catch (err) {
      console.error('[canvas] pinConversationToCanvasChat failed', err);
    }
  }

  const [canvas, modelCatalogue, allCanvases] = await Promise.all([
    loadCanvas(params.slug),
    loadModelCatalogue(),
    listCanvases(),
  ]);

  // Slug doesn't match any canvas — 404 cleanly. Previously
  // ensureCanvasWorkflow would silently seed a placeholder for unknown
  // slugs, which leaked junk canvases whenever the chat orchestrator
  // hallucinated a wrong /jkai/canvas/<slug> link.
  if (!canvas) {
    throw error(404, `Canvas "${params.slug}" not found.`);
  }

  // Reap any zombie `awaiting_human` runs for this canvas AFTER loading it
  // (so we use the workflowId already looked up). Fire-and-forget so page
  // load time isn't paid by the user — the next refresh picks up the reaped
  // state.
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

/**
 * Pin a /jkai conversation onto the canvas's first chat node so the
 * conversation thread "follows" the user when they click a canvas link
 * from the chat hub. Idempotent: re-running with the same conversation is
 * a no-op; pinning a different conversation overwrites the previous pin.
 */
async function pinConversationToCanvasChat(slug: string, conversationId: string) {
  // Cheap existence check — silently skip on bad ids so a stray ?conv=foo
  // can't 500 the page load.
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return;

  // Slug → workflowId via the `canvas:<slug>` workflow.name convention
  // (kept in sync with adapter.server's `workflowNameFor`).
  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.name, `canvas:${slug}`))
    .limit(1);
  if (!wf) return;

  const chatNodes = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.workflowId, wf.id), eq(workflowNodes.type, 'chat')));
  if (chatNodes.length === 0) return;

  const target = chatNodes[0];
  const cfg = (target.config as Record<string, unknown> | null) ?? {};
  if (cfg.conversationId === conversationId) return; // already pinned, idempotent
  await db
    .update(workflowNodes)
    .set({ config: { ...cfg, conversationId } })
    .where(eq(workflowNodes.id, target.id));
}
