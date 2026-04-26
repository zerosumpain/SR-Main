import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listJobs } from '$lib/health/backfill-service';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25)));
  const jobs = await listJobs(limit);
  return json({ jobs });
};
