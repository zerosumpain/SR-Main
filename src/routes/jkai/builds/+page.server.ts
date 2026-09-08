import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The builds list folded into /jkai/develop (2026-09-08), which now carries
// both the live portfolio and the archive of every earlier build. Kept as a
// redirect stub rather than deleted: `tests/lib/nav/nav-parents.test.ts` builds
// its route set from `+page.svelte` AND `+page.server.ts`, so this is what
// keeps the back link on /jkai/builds/<id> — still the console for an archive
// build — pointing at a route that exists.
export const load: PageServerLoad = ({ url }) => {
  throw redirect(308, `/jkai/develop${url.search}`);
};
