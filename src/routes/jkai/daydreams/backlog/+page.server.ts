import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The backlog moved out of daydreams into the build process (2026-09-26): it is
// where build work is queued and repaired, not something daydream thinks. Kept
// as a redirect stub so old bookmarks, WhatsApp reports and `#run-` links land.
// The browser carries the fragment across the 308.
export const load: PageServerLoad = ({ url }) => {
  throw redirect(308, `/jkai/develop/backlog${url.search}`);
};
