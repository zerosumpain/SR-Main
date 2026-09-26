import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listMembers } from '$lib/home/presence/members';
import { mayOpenPerson, peopleViewerOf } from '$lib/home/presence/viewer';
import { loadPersonMovement } from '$lib/home/presence/movement';
import type { Commute } from '$lib/home/presence/commuting';
import { DEFAULT_WINDOW_DAYS, type MovementStats } from '$lib/home/presence/stats';

// One person's page under /home/people. The owner may open anyone's; a
// household viewer only their own (spec D2), and a Family Admin their wards'
// too (access groups: `family:admin` + household_member.guardian_of). The stats this page carries
// are one person's journeys, and a journey starts at somebody's front door.
//
// The order matters: a household viewer asking for anyone but themselves is
// refused BEFORE the subject is looked up, so they get the same 403 whether
// or not that person exists — the page cannot be used to list the household.
// Only once both checks pass is the trail read at all.
export const load: PageServerLoad = async (event) => {
  const viewer = await peopleViewerOf(event);
  if (!viewer) error(403, 'Forbidden');

  const subject = event.params.subject;
  if (!mayOpenPerson(viewer, subject)) error(403, 'Forbidden');

  const member = (await listMembers()).find((m) => m.subject === subject);
  if (!member) error(404, 'Not found');

  // The stats are coordinate-free by construction: counts, distances, clock
  // times and the NAMES of places. `commuting` is the one exception (spec D3):
  // the newest drives and train rides with thinned routes, behind exactly this
  // gate — the same one the journeys the stats are made from sit behind.
  // A failed read still draws the page.
  let stats: MovementStats | null = null;
  let commuting: Commute[] = [];
  let loadError: string | null = null;
  try {
    ({ stats, commuting } = await loadPersonMovement(member.subject, { days: DEFAULT_WINDOW_DAYS }));
  } catch (err) {
    console.error('[home/people] movement stats failed:', err);
    loadError = 'The trail could not be read just now.';
  }

  return {
    subject: member.subject,
    displayName: member.displayName,
    days: DEFAULT_WINDOW_DAYS,
    stats,
    commuting,
    loadError,
  };
};
