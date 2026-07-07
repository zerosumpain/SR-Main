import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getToolAudit, clampDays } from '$lib/server/hermes-sessions';

// Homeserv-side proxy target for the tool-usage audit page (the Hermes session
// store is homeserv-local; the VPS reaches this over Tailscale). See hermes-remote.ts.
export const GET: RequestHandler = async ({ request, url }) => {
  assertHermesServiceRequest(request);
  return json(await getToolAudit(clampDays(url.searchParams.get('days'))));
};
