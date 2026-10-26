import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { recorderSpace } from '$lib/captures/store.server';
import { searchCaptures } from '$lib/captures/search.server';
import { isoOrNull } from '$lib/captures/validate';

/**
 * GET /api/native/captures/search?q=&person=&app=&place=&from=&to=&limit=
 *
 * The recorder's captures and the entities graphed from them — the recorder's
 * space ONLY, never the household (see $lib/captures/search.server).
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const p = url.searchParams;
  const text = (k: string, max = 200) => (p.get(k) ?? '').trim().slice(0, max);
  const from = p.get('from');
  const to = p.get('to');
  const fromIso = from ? isoOrNull(from) : null;
  const toIso = to ? isoOrNull(to) : null;
  if ((from && !fromIso) || (to && !toIso)) return json({ error: 'from and to must be ISO dates.' }, { status: 400 });
  return searchCaptures(recorderSpace(), {
    q: text('q'),
    person: text('person', 120),
    app: text('app', 80),
    place: text('place', 120),
    from: fromIso,
    to: toIso,
    limit: clampLimit(p.get('limit'), 20, 50),
  });
});
