import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Knowledge recall merged into Intel, and search IS the intel home page since
// the 2026-09-27 simplification — go straight there, not via /jkai/intel/search.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/jkai/intel');
};
