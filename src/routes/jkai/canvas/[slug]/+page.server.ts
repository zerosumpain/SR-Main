import type { PageServerLoad } from './$types';
import { loadCanvas, loadModelCatalogue, CANVAS_NODE_TYPES } from '$lib/canvas/adapter';

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
} from '$lib/canvas/adapter';

export const load: PageServerLoad = async ({ params }) => {
  const [canvas, modelCatalogue] = await Promise.all([
    loadCanvas(params.slug),
    loadModelCatalogue(),
  ]);
  return { canvas, modelCatalogue, nodeTypes: CANVAS_NODE_TYPES };
};
