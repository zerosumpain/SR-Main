import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getCallEfficiency, clampDays } from '$lib/server/hermes-sessions';

// Homeserv-side proxy target for the call-efficiency metric (tool calls per
// answered turn). The turn data lives only in homeserv's Hermes SQLite; the
// self-improvement engine reads it from the VPS over Tailscale. Mirrors
// ./toolaudit — see hermes-remote.ts.
export const GET: RequestHandler = async ({ request, url }) => {
  assertHermesServiceRequest(request);
  return json(await getCallEfficiency(clampDays(url.searchParams.get('days'))));
};
