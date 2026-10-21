import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { jobAccepted, wantsAsync } from '$lib/trips/jobs.server';
import { parsePackAsk } from '$lib/trips/pack';
import { buildPack, morePlaces, packWire, refreshPack, startPackJob } from '$lib/trips/pack.server';

/**
 * GET /api/trips/:id/pack — v8: the research pack. `?kind=` (comma list;
 * `food` includes cafés and gelato) and `?tag=` filter the places →
 * `{ pack: PackSummary, places: PackPlace[] }`.
 */
export const GET: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const q = event.url.searchParams;
  return json(await packWire(trip.id, { kind: q.get('kind'), tag: q.get('tag') }), { headers: { 'cache-control': 'private, no-store' } });
};

/**
 * POST /api/trips/:id/pack — `{ action: 'build'|'refresh'|'more', theme?, async? }`.
 * `"async": true` → 202 `{ job }` (stages: finding places, places to eat,
 * opening hours on your dates, closures and events, writing it up); the
 * job's result is `{ pack, places }`. A build already running is joined.
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const body = await readJson(event);
  const ask = parsePackAsk(body);
  if (!ask.ok) return json({ error: ask.error }, { status: 400 });
  if (wantsAsync(body)) {
    const started = startPackJob(trip, owner, ask.action, { theme: ask.theme });
    if (!started.mine) return json({ error: 'The research is already running — it will show here when it is ready.' }, { status: 409 });
    return jobAccepted(started.job);
  }
  const result = ask.action === 'refresh' ? await refreshPack(trip, null) : ask.action === 'more' ? await morePlaces(trip, ask.theme, null) : await buildPack(trip, null);
  return json(result);
};
