import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { probeEstate } from '$lib/estate/probe.server';
import { readHostCards } from '$lib/estate/vitals.server';

// Owner-gated by hooks (/api/admin/*). Fetched by the status strip on /admin
// AFTER mount, never in the page loader: this reaches across the tailnet to two
// boxes and back, and /admin is the page opened dozens of times a day. Paying
// that latency on every render of the console — to fill in two tiles — is the
// wrong trade, and it is the same call the header usage windows made.
export const GET: RequestHandler = async () => {
  const health = await probeEstate();
  const hosts = await readHostCards(health);
  return json({ hosts, at: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
};
