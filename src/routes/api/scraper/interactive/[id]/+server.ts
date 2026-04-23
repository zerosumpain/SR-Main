import { json, type RequestHandler } from '@sveltejs/kit';
import { stopInteractiveSession } from '$lib/workflows/scraper/interactive';
import { assertScraperServiceRequest } from '$lib/workflows/scraper/service-auth';

export const DELETE: RequestHandler = async ({ params, request }) => {
  assertScraperServiceRequest(request);
  await stopInteractiveSession(params.id!);
  return json({ ok: true });
};
