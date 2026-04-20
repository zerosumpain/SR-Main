import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// New workflows are created via the canvas index.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/jkai/canvas');
};
