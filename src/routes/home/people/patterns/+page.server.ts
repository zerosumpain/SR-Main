import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { errMsg } from '$lib/home/presence/types';

// Movement patterns — the OWNER's page: ninety days of where each person goes
// and what kind of place it is, the shape of their day, who they are with,
// what they travel for what they stay, and what their steps do on the days
// they go out. Built nightly (`patterns.server`); the load only reads the
// stored report and narrows it to `?person=`. Not in the access catalogue,
// so the hook refuses anyone else; the load and the action check again.

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const { loadPatterns } = await import('$lib/home/presence/patterns.server');
  const report = await loadPatterns();
  const asked = event.url.searchParams.get('person');
  // A person who is not in the report is ignored, not an error — as on /home/people.
  const person = report?.people.some((p) => p.subject === asked) ? asked : null;
  return { report, person };
};

export const actions: Actions = {
  rebuild: async (event) => {
    if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
    const { runPatterns } = await import('$lib/home/presence/patterns.server');
    try {
      // Three batches of new place lookups at most: the owner is waiting; the night does the rest.
      const r = await runPatterns(new Date(), 3);
      return { rebuilt: r.people.length };
    } catch (err) {
      return fail(500, { error: errMsg(err) });
    }
  },
};
