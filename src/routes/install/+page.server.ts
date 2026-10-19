import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /install on its own is not a page: the install page needs its token
 * (/install/<token>, `$lib/server/adhoc-install`). It is the back link's
 * parent, though, so it goes somewhere useful rather than 404ing.
 */
export const load: PageServerLoad = () => {
  throw redirect(307, '/welcome');
};
