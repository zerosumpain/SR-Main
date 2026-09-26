import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The improvement room moved out of daydreams into the build process
// (2026-09-26), next to the backlog and the doctor. Kept as a redirect stub so
// old bookmarks, nightly reports and `#run-` links land. The browser carries
// the fragment across the 308.
export const load: PageServerLoad = ({ url }) => {
  throw redirect(308, `/jkai/develop/improvement${url.search}`);
};
