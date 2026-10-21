import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { jobAccepted, wantsAsync } from '$lib/trips/jobs.server';
import { parsePackAsk } from '$lib/trips/pack';
import { buildPack, morePlaces, packWire, refreshPack, startPackJob } from '$lib/trips/pack.server';

/**
 * GET /api/native/trips/:id/pack — v8: the research pack, for anyone in the
 * family who may open the trip (places and date facts only — no memory).
 * `?kind=&tag=` → `{ pack, places }`.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const q = event.url.searchParams;
  return json(await packWire(ft.trip.id, { kind: q.get('kind'), tag: q.get('tag') }), { headers: { 'cache-control': 'private, no-store' } });
});

/**
 * POST /api/native/trips/:id/pack — `{ action: 'build'|'refresh'|'more',
 * theme?, async? }`: whoever made the trip or a parent (research costs
 * money). `"async": true` → 202 `{ job }`; poll GET /api/native/trips/jobs/:jobId.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  if (!ft.access.canEdit && !ft.access.canApprove) return json({ error: 'Whoever made the trip, or a parent, can ask for more research.' }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as unknown;
  const ask = parsePackAsk(body);
  if (!ask.ok) return json({ error: ask.error }, { status: 400 });
  if (wantsAsync(body)) {
    const started = startPackJob(ft.trip, ft.caller.email, ask.action, { theme: ask.theme });
    if (!started.mine) return json({ error: 'The research is already running — it will show here when it is ready.' }, { status: 409 });
    return jobAccepted(started.job);
  }
  const result = ask.action === 'refresh' ? await refreshPack(ft.trip, null) : ask.action === 'more' ? await morePlaces(ft.trip, ask.theme, null) : await buildPack(ft.trip, null);
  return json(result);
});
