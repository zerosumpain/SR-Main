import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/** Retired tabbed dashboard — the live desk replaces it. */
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/deepdive/${params.id}`);
};
