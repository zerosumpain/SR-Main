import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isHeroSlot } from '$lib/constants/hero-slots';
import { isOwnerRequest } from '$lib/server/owner';
import { heroPreparation, prepareHeroSource, restoreBundledHero } from '$lib/server/hero-sources';

export const GET: RequestHandler = async event => {
  if (!await isOwnerRequest(event)) error(403, 'Owner access required');
  return json({ job: await heroPreparation() }, { headers: { 'cache-control': 'no-store' } });
};
export const POST: RequestHandler = async event => {
  if (!await isOwnerRequest(event)) error(403, 'Owner access required');
  const body = await event.request.json().catch(() => null);
  if (!body || typeof body.sourceId !== 'string') error(400, 'Choose an animation');
  const slot = body.slot ?? 'default';
  if (!isHeroSlot(slot)) error(400, 'Choose a valid animation slot');
  try {
    if (body.sourceId === '') {
      await restoreBundledHero(slot);
      return json({ job: await heroPreparation() });
    }
    return json({ job: await prepareHeroSource(body.sourceId, slot) }, { status: 202 });
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Could not prepare animation' }, { status: 400 }); }
};
