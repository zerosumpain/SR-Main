import type { PageServerLoad } from './$types';
import { listCanvases } from '$lib/canvas/adapter';

export type { CanvasSummary } from '$lib/canvas/adapter';

export const load: PageServerLoad = async () => {
  const canvases = await listCanvases();
  return { canvases };
};
