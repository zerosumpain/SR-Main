import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { loadRunDetail } from '$lib/workflows/native/workflows.server';

/**
 * GET /api/native/workflows/runs/:runId — one run, step by step, in the
 * workflow's own order: status, duration, error, and a 4 KB pretty-JSON
 * preview of each step's output.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const detail = await loadRunDetail(params.runId);
  if (!detail) return json({ error: 'Run not found' }, { status: 404 });
  return { run: detail.run, steps: detail.steps };
});
