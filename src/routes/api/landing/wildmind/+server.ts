import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { offlineShowcase } from '$lib/landing/wildmind';
import { WILDMIND_VIEWS, wildmindShowcase, type WildmindView } from '$lib/landing/wildmind.server';

/**
 * Public, read-only: Wildmind's valley for the landing page's poll.
 *
 * Listed exactly in PUBLIC_API_PATHS. It answers from the per-process memo in
 * wildmind.server.ts (one upstream read per twenty seconds however many people
 * poll), carries names, enums and counts only, and always answers 200: an
 * unconfigured or silent Wildmind is `offline`, never an error. `?have=` is the
 * map version the page already holds; when it matches, the paths are left out.
 * `?view=notes` asks for the map drawn the notes view's way (pencilled, with
 * the words placed); any other value is ignored. Nothing from the request but
 * those two is used, and neither ever goes upstream.
 */

const VERSION = /^[A-Za-z0-9._:-]{1,64}$/;

export const GET: RequestHandler = async ({ url }) => {
  const have = url.searchParams.get('have');
  const view = url.searchParams.get('view');
  const known = WILDMIND_VIEWS.find((v): v is WildmindView => v === view) ?? null;
  const body = (await wildmindShowcase(new Date(), have && VERSION.test(have) ? have : null, known)) ?? offlineShowcase();
  return json(body, { headers: { 'cache-control': 'public, max-age=15, stale-while-revalidate=60' } });
};
