import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readBuildState } from '$lib/workflows/build-state.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * GET /api/canvas/:slug/build-state → { building, buildError }
 *
 * Polled by a canvas that is being built from a description, as a backstop to
 * the /live stream's `build_complete` (which a tab opened late, or a dropped
 * connection, can miss).
 */
export const GET: RequestHandler = async ({ params }) => {
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Canvas not found' }, { status: 404 });
  return json(await readBuildState(workflow.id));
};
