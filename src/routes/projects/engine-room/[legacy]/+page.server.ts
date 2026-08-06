import { error, redirect } from '@sveltejs/kit';
import { REDIRECTS } from '../lib/nav';
import type { PageServerLoad } from './$types';

// The study first shipped as ten flat sections. Those URLs were public, so they still
// resolve — permanently redirected to wherever the content now lives. SvelteKit matches
// static routes before dynamic ones, so /turn, /memory, /reach and /change never reach here.
export const load: PageServerLoad = async ({ params }) => {
  const target = REDIRECTS[params.legacy];
  if (target) redirect(308, target);
  error(404, 'No such page in this study');
};
