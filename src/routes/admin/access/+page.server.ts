import type { PageServerLoad } from './$types';
import { loadPeople } from '$lib/people/people.server';
import { listInvites } from '$lib/server/invites';
import { listRequests } from '$lib/server/access-requests';

// Owner-only: /admin is never in the access catalogue, so the hook's default
// deny covers this page. Changes go through /api/admin/access/*; the page
// re-runs this load after each one.
export const load: PageServerLoad = async () => {
  const [people, invites, requests] = await Promise.all([loadPeople(), listInvites(), listRequests()]);
  return { ...people, invites, requests };
};
