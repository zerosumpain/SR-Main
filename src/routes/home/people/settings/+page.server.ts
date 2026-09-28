import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The household's people are edited on their own pages at /admin/access now,
// alongside their access and phones. Kept as a redirect so old links land.
export const load: PageServerLoad = () => {
  redirect(308, '/admin/access');
};
