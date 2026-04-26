import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startBackfillJob, type BackfillService } from '$lib/health/backfill-service';

const VALID_SERVICES: BackfillService[] = ['strava', 'whoop', 'all'];

export const POST: RequestHandler = async ({ url, request }) => {
  const service = url.searchParams.get('service') as BackfillService | null;
  if (!service || !VALID_SERVICES.includes(service)) {
    throw error(400, `service query param must be one of: ${VALID_SERVICES.join(', ')}`);
  }

  const body = (await request.json().catch(() => ({}))) as { start?: string; end?: string };
  const { jobId } = await startBackfillJob({ service, start: body.start, end: body.end });
  return json({ jobId });
};
