import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // /projects is now the canonical published-projects index. Keep this route
  // alive only so individual published apps at /projects/jkai/<slug>/ still
  // serve correctly — the bare /projects/jkai page redirects up.
  throw redirect(307, '/projects');
};
