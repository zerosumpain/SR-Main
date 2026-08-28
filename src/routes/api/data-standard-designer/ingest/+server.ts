// POST /api/data-standard-designer/ingest — run an emerging-standards discovery
// pass (index-driven fetch + LLM classify + upsert). Driven by the daily jkai
// cron workflow; also callable manually from the portal. GET returns the
// registry snapshot (entries + per-source coverage health) for the portal.
//
// Auth: if DSD_INGEST_SECRET is set, a matching Bearer token is required
// (mirrors the policy-engine ingest route). Bypasses Auth.js via hooks.server.ts.

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runDiscovery, getRegistrySnapshot } from '$lib/data-standard-designer/discovery.server';
import type { RequestHandler } from './$types';

function authorized(request: Request): boolean {
  const secret = env.DSD_INGEST_SECRET;
  if (!secret) return true; // unset → open (dev convenience), same as policy-engine
  return (request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export const POST: RequestHandler = async ({ request }) => {
  if (!authorized(request)) throw error(401, 'unauthorized');
  const body = (await request.json().catch(() => ({}))) as { classify?: boolean };
  const summary = await runDiscovery({ classify: body.classify !== false });
  return json(summary);
};

export const GET: RequestHandler = async () => {
  const snapshot = await getRegistrySnapshot();
  return json(snapshot);
};
