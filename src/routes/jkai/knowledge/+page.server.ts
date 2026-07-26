import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Knowledge recall merged into Intel — /jkai/intel/search now searches the
// intel graph AND files/research/memory/datastore in one pass.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/jkai/intel/search');
};
