// POST /api/data-standard-designer/ingest — run an emerging-standards discovery
// pass (index-driven fetch + LLM classify + upsert). Driven by the daily jkai
// cron workflow; also callable manually from the portal. GET returns the
// registry snapshot (entries + per-source coverage health) for the portal.
//
// Auth: if DSD_INGEST_SECRET is set, a matching Bearer token is required
// (mirrors the policy-engine ingest route). Bypasses Auth.js via hooks.server.ts.

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runDiscovery, getRegistrySnapshot } from '$lib/data-standard-designer/discovery.server';
import type { RequestHandler } from './$types';
import { assertBearerSecret, readLimitedJson } from '$lib/server/service-auth';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  assertPublicRequestBudget(event, {
    scope: 'dsd-ingest', perClient: { capacity: 6, refillPerSecond: 6 / 60 },
    global: { capacity: 20, refillPerSecond: 20 / 60 },
  });
  assertBearerSecret(request, env.DSD_INGEST_SECRET, 'DSD_INGEST_SECRET');
  const body = await readLimitedJson<{ classify?: boolean }>(request, 8_192);
  const summary = await runDiscovery({ classify: body.classify !== false });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  const snapshot = await getRegistrySnapshot();
  return json(snapshot);
};
