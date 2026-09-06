import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseDrillTarget } from '$lib/jkai/context-panel/drill';
import { composeDrill } from '$lib/jkai/context-panel/drill.server';

// What a double-click on the thread inspector opens. Owner-gated by hooks,
// like the rest of /api/jkai. The target grammar lives in one tested module
// so a malformed key is a 400 here rather than a guess.
export const GET: RequestHandler = async ({ params, url }) => {
  const key = url.searchParams.get('target') ?? '';
  const target = parseDrillTarget(key);
  if (!target) return json({ error: 'Unknown drill target' }, { status: 400 });
  const manifest = await composeDrill(params.id, target);
  if (!manifest) return json({ error: 'Nothing to drill into' }, { status: 404 });
  return json(manifest, { headers: { 'cache-control': 'private, no-store' } });
};
