import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { nodeTypeCatalogue } from '$lib/workflows/native/catalogue';

/**
 * GET /api/native/workflows/node-types — the "Add step" catalogue: the canvas
 * palette's own list, grouped the way the palette groups it, minus what a
 * phone cannot place (see `native/catalogue.ts`).
 *
 * A static segment, so SvelteKit matches it before `[slug]`; a canvas slugged
 * `node-types` would be unreachable from the phone.
 */
export const GET: RequestHandler = withDevice(async () => {
  return { categories: nodeTypeCatalogue() };
});
