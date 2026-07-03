import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The standalone radar page is retired: intelligence now surfaces inline on the
// section it bears on (legislation, commitments, landscape, strategies, frameworks),
// with an on-demand scan in the nav. Old links land on the briefing.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/projects/dfe-data-strategy');
};
