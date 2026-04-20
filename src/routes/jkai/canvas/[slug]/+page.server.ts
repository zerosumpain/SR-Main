import type { PageServerLoad } from './$types';
import { loadCanvas } from '$lib/canvas/adapter';

export type { NodeKind, NodeStatus, CanvasNode, CanvasEdge, Canvas } from '$lib/canvas/adapter';

export const load: PageServerLoad = async ({ params }) => {
  const canvas = await loadCanvas(params.slug);
  return { canvas };
};
