import type { PageServerLoad } from './$types';
import { loadCanvas, loadModelCatalogue } from '$lib/canvas/adapter';

export type {
  NodeKind,
  NodeStatus,
  CanvasNode,
  CanvasEdge,
  Canvas,
  ModelCatalogue,
  ModelOption,
} from '$lib/canvas/adapter';

export const load: PageServerLoad = async ({ params }) => {
  const [canvas, modelCatalogue] = await Promise.all([
    loadCanvas(params.slug),
    loadModelCatalogue(),
  ]);
  return { canvas, modelCatalogue };
};
