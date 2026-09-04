import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readDependencyOverview } from '$lib/dependencies/history.server';
import { runDependencyCheck } from '$lib/dependencies/monitor.server';

// Owner-gated by hooks (/api/admin/*). GET reads the durable history and only
// performs network work when the table has never received an observation.
export const GET: RequestHandler = async () => {
  let overview = await readDependencyOverview();
  if (!overview.observedFrom) {
    await runDependencyCheck();
    overview = await readDependencyOverview();
  }
  return json(overview, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async () => {
  await runDependencyCheck();
  return json(await readDependencyOverview(), { headers: { 'Cache-Control': 'no-store' } });
};
