import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/** Consolidated into the single /research family (v3); 'quick' is now depth='scan'. */
export const load: PageServerLoad = async () => {
  throw redirect(308, '/research');
};
