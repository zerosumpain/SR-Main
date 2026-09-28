import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Insights folded into /home/people (the travel desk) on 2026-09-28: routes,
// routines, arrivals and the rest now sit beside the live band on one page.
// This only forwards, carrying the two filters the page shares. It reads
// nothing: /home/people's load scopes every viewer and ignores a `person` it
// will not show, so the redirect says no more than the URL already did.
export const load: PageServerLoad = ({ url }) => {
  const q = new URLSearchParams();
  const person = url.searchParams.get('person');
  const days = url.searchParams.get('days');
  if (person) q.set('person', person);
  if (days) q.set('days', days);
  const s = q.toString();
  redirect(308, `/home/people${s ? `?${s}` : ''}`);
};
