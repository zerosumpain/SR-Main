import type { PageServerLoad } from './$types';
import { listCanvases, listCanvasStats } from '$lib/canvas/adapter.server';

export type { CanvasSummary } from '$lib/canvas/adapter';

export const load: PageServerLoad = async () => {
  const [canvases, stats] = await Promise.all([listCanvases(), listCanvasStats()]);
  return { canvases, stats };
};
