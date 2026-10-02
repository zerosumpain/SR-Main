import { json, type RequestHandler } from '@sveltejs/kit';
import { stopInteractiveSession } from '$lib/scraper/interactive';
import { assertScraperServiceRequest } from '$lib/scraper/service-auth';

export const DELETE: RequestHandler = async ({ params, request }) => {
  assertScraperServiceRequest(request);
  await stopInteractiveSession(params.id!);
  return json({ ok: true });
};
