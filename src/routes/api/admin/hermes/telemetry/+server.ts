import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getTelemetry, clampDays } from '$lib/server/hermes-sessions';

export const GET: RequestHandler = async ({ request, url }) => {
  assertHermesServiceRequest(request);
  return json(await getTelemetry(clampDays(url.searchParams.get('days'))));
};
