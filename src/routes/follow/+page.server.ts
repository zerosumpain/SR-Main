import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /follow has nothing of its own — a live walk is only ever /follow/<token>.
 * A load-only stub so the bar's back link from a walk lands somewhere real.
 */
export const load: PageServerLoad = () => {
  throw redirect(308, '/');
};
