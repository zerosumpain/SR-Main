import { json } from '@sveltejs/kit';
import { syncAll } from '$lib/health/sync-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const fullBackfill = body.fullBackfill === true;

  const result = await syncAll({ fullBackfill, maxPages: fullBackfill ? 20 : 1 });
  return json(result);
};
