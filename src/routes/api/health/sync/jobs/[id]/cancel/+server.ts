import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelBackfillJob } from '$lib/health/backfill-service';

export const POST: RequestHandler = async ({ params }) => {
  const result = await cancelBackfillJob(params.id);
  return json(result, { status: result.ok ? 200 : 404 });
};
