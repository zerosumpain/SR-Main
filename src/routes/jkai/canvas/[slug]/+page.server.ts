import type { PageServerLoad } from './$types';
import {
  loadCanvas,
  loadModelCatalogue,
  listCanvases,
  CANVAS_NODE_TYPES,
} from '$lib/canvas/adapter';

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
  // Strip this canvas from the peers list (used by the event-trigger picker)
  const peerCanvases = allCanvases.filter((c) => c.workflowId !== canvas.workflowId);
  return { canvas, modelCatalogue, nodeTypes: CANVAS_NODE_TYPES, peerCanvases };
};
