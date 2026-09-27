import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The old one-person page. Everyone is on /home/people now, filtered by
// person, so this only forwards — links from before (and the phone) keep
// working. It reads nothing: /home/people's load decides who may see whose
// movement, and a `person` it will not show is ignored there, so the redirect
// says no more than the URL already did.
export const load: PageServerLoad = ({ params }) => {
  redirect(308, `/home/people?person=${encodeURIComponent(params.subject)}`);
};
