import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { runServiceAction, isServiceAction } from '$lib/server/hermes-control';

export const POST: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (!isServiceAction(body?.action)) throw error(400, 'unknown service action');
  return json(await runServiceAction(body.action));
};
