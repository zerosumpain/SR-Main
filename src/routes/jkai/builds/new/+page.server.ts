import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Commissioning happens on /jkai/develop now: an outcome, a product area and a
// model, groomed into a brief. The four sandbox-era knobs this form carried —
// the lane radio, studio evidence mode, the per-hour pacing caps and the
// design-system toggle — have no place on a whole-site brief; the app, studio
// and forge lanes are still created by their chat tools and APIs.
export const load: PageServerLoad = () => {
  throw redirect(308, '/jkai/develop');
};
