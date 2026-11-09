import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { mayOpenPerson, peopleViewerOf, type PeopleViewer } from '$lib/home/presence/viewer';

/**
 * GET /api/native/family/movement?subject=<s>&days=30|90 — one person's
 * movement as figures, for the app's "Your walking" page: walking pace (and
 * by week), the trips they repeat with time, distance and — on foot — pace,
 * how they got about by mode, and time out per day (`movementStats`). No
 * coordinate: the commuting routes the web page draws are left out.
 *
 * Gated as the person page is (`mayOpenPerson`): the owner's phone anyone's,
 * a member's (Family Circle or Family Admin) their own and their wards'.
 * Anyone else 403s; a subject they may not open 404s, so a guess cannot tell
 * a stranger from a sibling.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, _identity, role) => {
  let viewer: PeopleViewer | null;
  if (role === 'owner') viewer = { kind: 'owner' };
  else viewer = await peopleViewerOf(event);
  if (!viewer) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const subject = (event.url.searchParams.get('subject') ?? '').trim();
  if (!subject) return json({ error: 'Say whose movement.' }, { status: 400 });
  if (!mayOpenPerson(viewer, subject)) return json({ error: 'Nobody by that name is yours to look at.' }, { status: 404 });
  const asked = Number(event.url.searchParams.get('days'));
  const days = [30, 90].includes(asked) ? asked : 30;

  const { listMembers } = await import('$lib/home/presence/members');
  const member = (await listMembers()).find((m) => m.subject === subject);
  if (!member) return json({ error: 'Nobody by that name is yours to look at.' }, { status: 404 });
  const { loadPeopleMovement } = await import('$lib/home/presence/movement');
  const [person] = await loadPeopleMovement([{ subject, displayName: member.displayName || subject }], { days });
  if (!person?.stats) return json({ error: person?.error ?? 'The trail could not be read just now.' }, { status: 503 });
  return json({ subject, name: person.displayName, days, stats: person.stats });
});
