import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { peopleViewerOf, type PeopleViewer } from '$lib/home/presence/viewer';

/**
 * GET /api/native/family/forecast — the travel desk's forecast for the app:
 * each person's next likely move and arrival window, what looks off, the
 * learned routines, live arrivals and the departure pattern. The same
 * computation /home/people draws (`loadForecast`), so the phone and the page
 * never disagree.
 *
 * Scoped like the page, by `insightMembers`: the owner's phone gets everyone
 * sharing; a member's phone (Family Circle or Family Admin) gets themselves and
 * their wards, and nobody else's routine. Anyone else is refused. `?days=` is
 * 7, 28 (default) or 90.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, _identity, role) => {
  let viewer: PeopleViewer | null;
  if (role === 'owner') viewer = { kind: 'owner' };
  // The request was made to look like the member signed in on the web, so
  // the page's own viewer check answers for them.
  else viewer = await peopleViewerOf(event);
  if (!viewer) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const asked = Number(event.url.searchParams.get('days'));
  const days = [7, 28, 90].includes(asked) ? asked : 28;
  const { loadForecast } = await import('$lib/home/presence/forecast.server');
  const { forecast, insights } = await loadForecast(viewer, days);
  return {
    ...forecast,
    people: insights.people.map((p) => ({ subject: p.subject, name: p.displayName, coverage: p.coverage })),
  };
});
