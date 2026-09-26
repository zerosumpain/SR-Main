import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listMembers } from '$lib/home/presence/members';
import { mayOpenPerson, peopleViewerOf } from '$lib/home/presence/viewer';
import { loadPersonMovement } from '$lib/home/presence/movement';
import { ownDayOf } from '$lib/home/presence/my-day';
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

  // "Your day" (spec Contract G) shows only on the viewer's OWN page: a
  // circle member on theirs, the owner on theirs. The owner on anyone else's
  // page, and a Family Admin on a ward's, see nothing of it — the day is read
  // from the viewer's own phone account, not the subject's. The section loads
  // its data lazily from /api/home/people/my-day, which is keyed on the
  // session alone; this flag only decides whether to offer it.
  const own = await ownDayOf(event).catch(() => null);
  const yourDay = !!own && own.subject === member.subject;

  return {
    subject: member.subject,
    yourDay,
    displayName: member.displayName,
    days: DEFAULT_WINDOW_DAYS,
    stats,
    commuting,
    loadError,
  };
};
