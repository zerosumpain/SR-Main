// POST /api/dfe-data-strategy/intel — run an intelligence sweep (GOV.UK fetch + LLM classify
// against the strategy + upsert). Driven by the daily jkai cron; also callable manually.
// GET returns the radar snapshot. Auth: KEYSTONE_INTEL_SECRET as a Bearer token (if set).
// Bypasses Auth.js via hooks.server.ts (service-to-service, like the policy-engine ingest).

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isOwnerEmail } from '$lib/server/access';
import { runIntel, getIntelSnapshot } from '../../../projects/dfe-data-strategy/lib/intel.server';
import type { RequestHandler } from './$types';

async function authorized(event: Parameters<RequestHandler>[0]): Promise<boolean> {
  const secret = env.KEYSTONE_INTEL_SECRET;
  if (!secret) return true; // unset → open (dev convenience), same as policy-engine / DSD
  if ((event.request.headers.get('authorization') ?? '') === `Bearer ${secret}`) return true;
  // the nav's on-demand "scan" button posts from the browser with the owner's
  // session (this route bypasses the hook's owner gate as a service endpoint, so
  // gate on owner here — a guest session must not trigger sweeps).
  try {
    const session = await event.locals.auth?.();
    return isOwnerEmail(session?.user?.email);
  } catch {
    return false;
  }
}

export const POST: RequestHandler = async (event) => {
  if (!(await authorized(event))) throw error(401, 'unauthorized');
  const body = (await event.request.json().catch(() => ({}))) as { classify?: boolean; force?: boolean };
  const summary = await runIntel({ classify: body.classify !== false, force: body.force === true });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  return json(await getIntelSnapshot());
};
