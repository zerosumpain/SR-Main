import { error, redirect } from '@sveltejs/kit';
import { REDIRECTS } from '../lib/nav';
import type { PageServerLoad } from './$types';

// Every URL this study has had stays reachable: retired pages 308 to wherever the subject
// now lives (lib/nav.ts REDIRECTS). Static routes match first, so live pages never get here.
export const load: PageServerLoad = async ({ params }) => {
  const target = REDIRECTS[params.legacy.replace(/\/$/, '')];
  if (target) redirect(308, target);
  error(404, 'No such page in this study');
};
