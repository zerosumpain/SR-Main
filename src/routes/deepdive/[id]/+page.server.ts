import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/** The dashboard is the run's home now; the canvas lives at /research/<id>/desk. */
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/research/${params.id}`);
};
