// POST /api/dfe-data-strategy/intel — run an intelligence sweep (GOV.UK fetch + LLM classify
// against the strategy + upsert). Driven by the daily jkai cron; also callable manually.
// GET returns the radar snapshot. Auth: KEYSTONE_INTEL_SECRET as a Bearer token (if set).
// Bypasses Auth.js via hooks.server.ts (service-to-service, like the policy-engine ingest).

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runIntel, getIntelSnapshot } from '../../../projects/dfe-data-strategy/lib/intel.server';
import type { RequestHandler } from './$types';

function authorized(request: Request): boolean {
  const secret = env.KEYSTONE_INTEL_SECRET;
  if (!secret) return true; // unset → open (dev convenience), same as policy-engine / DSD
  return (request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export const POST: RequestHandler = async ({ request }) => {
  if (!authorized(request)) throw error(401, 'unauthorized');
  const body = (await request.json().catch(() => ({}))) as { classify?: boolean; force?: boolean };
  const summary = await runIntel({ classify: body.classify !== false, force: body.force === true });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  return json(await getIntelSnapshot());
};
