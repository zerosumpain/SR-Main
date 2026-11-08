import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { recorderSpace } from '$lib/captures/store.server';
import { captureEntityPage } from '$lib/captures/search.server';

/**
 * GET /api/native/captures/entities/:entityId — one entity from the
 * recorder's graph, every capture that mentions it, and its depth-1
 * neighbourhood. An entity outside the recorder's space is a 404.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const page = await captureEntityPage(recorderSpace(), params.entityId);
  if (!page) return json({ error: 'No such entity.' }, { status: 404 });
  return page;
});
