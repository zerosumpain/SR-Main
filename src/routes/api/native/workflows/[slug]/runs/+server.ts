import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { findCanvas, listRuns } from '$lib/workflows/native/workflows.server';

/** GET /api/native/workflows/:slug/runs?limit= → { runs: [RunSummaryDTO] }, newest first. */
export const GET: RequestHandler = withDevice(async ({ params, url }) => {
  const limit = clampLimit(url.searchParams.get('limit'), 20, 100);
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });
  return { runs: await listRuns(workflow.id, limit) };
});
