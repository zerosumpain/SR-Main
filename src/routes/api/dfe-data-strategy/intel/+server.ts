// POST /api/dfe-data-strategy/intel — run an intelligence sweep (GOV.UK fetch + LLM classify
// against the strategy + upsert). Driven by the daily jkai cron; also callable manually.
// GET returns the radar snapshot. Auth: KEYSTONE_INTEL_SECRET as a Bearer token (if set).
// Bypasses Auth.js via hooks.server.ts (service-to-service, like the policy-engine ingest).

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isOwnerEmail } from '$lib/server/access';
import { runIntel, getIntelSnapshot } from '$lib/dfe-data-strategy/intel.server';
import type { RequestHandler } from './$types';
import { assertBearerSecret, readLimitedJson } from '$lib/server/service-auth';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';

async function authorized(event: Parameters<RequestHandler>[0]): Promise<boolean> {
  // the nav's on-demand "scan" button posts from the browser with the owner's
  // session (this route bypasses the hook's owner gate as a service endpoint, so
  // gate on owner here — a guest session must not trigger sweeps).
  try {
    const session = await event.locals.auth?.();
    if (isOwnerEmail(session?.user?.email)) return true;
  } catch {
    // Fall through to service authentication.
  }
  assertBearerSecret(event.request, env.KEYSTONE_INTEL_SECRET, 'KEYSTONE_INTEL_SECRET');
  return true;
}

export const POST: RequestHandler = async (event) => {
  assertPublicRequestBudget(event, {
    scope: 'keystone-intel', perClient: { capacity: 6, refillPerSecond: 6 / 60 },
    global: { capacity: 20, refillPerSecond: 20 / 60 },
  });
  await authorized(event);
  const body = await readLimitedJson<{ classify?: boolean; force?: boolean }>(event.request, 8_192);
  const summary = await runIntel({ classify: body.classify !== false, force: body.force === true });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  return json(await getIntelSnapshot());
};
