import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { peopleViewerOf, type PeopleViewer } from '$lib/home/presence/viewer';
import { buildMoveHistory } from '$lib/home/presence/move-history';

/**
 * GET /api/native/family/forecast/history?subject=<s>&days=7|28|90 — one
 * person's moves looked back at, for the app's page behind a name on the
 * family's next moves: places, routes and whether they are getting quicker,
 * how each routine keeps time, the trips themselves and when in the week they
 * leave (`buildMoveHistory`). `days` defaults to 90.
 *
 * Gated exactly as the forecast: the owner's phone may ask after anyone
 * sharing; a member's (Family Circle or Family Admin) after themselves and
 * their wards. Anyone else 403s; a subject outside the viewer's people 404s.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, _identity, role) => {
  let viewer: PeopleViewer | null;
  if (role === 'owner') viewer = { kind: 'owner' };
  else viewer = await peopleViewerOf(event);
  if (!viewer) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const subject = (event.url.searchParams.get('subject') ?? '').trim();
  if (!subject) return json({ error: 'Say whose moves.' }, { status: 400 });
  const asked = Number(event.url.searchParams.get('days'));
  const days = [7, 28, 90].includes(asked) ? asked : 90;
  const { loadForecast } = await import('$lib/home/presence/forecast.server');
  const now = new Date();
  const { insights } = await loadForecast(viewer, days, subject, now);
  const history = buildMoveHistory(insights, subject, now);
  if (!history) return json({ error: 'Nobody by that name is yours to look at.' }, { status: 404 });
  return history;
});
