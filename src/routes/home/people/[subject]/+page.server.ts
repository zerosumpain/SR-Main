import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listMembers } from '$lib/home/presence/members';
import { peopleViewerOf } from '$lib/home/presence/viewer';

// One person's page under /home/people. The owner may open anyone's; a
// household viewer only their own (spec D2). The stats this page will carry
// are one person's journeys, and a journey starts at somebody's front door.
//
// The order matters: a household viewer asking for anyone but themselves is
// refused BEFORE the subject is looked up, so they get the same 403 whether
// or not that person exists — the page cannot be used to list the household.
export const load: PageServerLoad = async (event) => {
  const viewer = await peopleViewerOf(event);
  if (!viewer) error(403, 'Forbidden');

  const subject = event.params.subject;
  if (viewer.kind === 'household' && subject !== viewer.subject) error(403, 'Forbidden');

  const member = (await listMembers()).find((m) => m.subject === subject);
  if (!member) error(404, 'Not found');

  return { subject: member.subject, displayName: member.displayName };
};
