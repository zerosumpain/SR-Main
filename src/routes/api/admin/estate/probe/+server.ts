import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { probeEstate } from '$lib/estate/probe.server';

// Owner-gated by hooks (/api/admin/*). Polled by /admin/estate for live status.
export const GET: RequestHandler = async () => {
  return json({ health: await probeEstate(), at: Date.now() });
};
