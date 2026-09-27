import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/home/presence/types';
import { livePositions, loadHousehold, type LivePosition } from '$lib/home/presence/household';
import { loadFeedChecks, type FeedCheck } from '$lib/home/presence/feed-checks';
import { listMembers } from '$lib/home/presence/members';
import { loadPeopleMovement, type PersonMovement } from '$lib/home/presence/movement';
import { ownDayOf } from '$lib/home/presence/my-day';
import { DEFAULT_WINDOW_DAYS } from '$lib/home/presence/stats';
import {
  mayOpenPerson,
  peopleViewerOf,
  personLinks,
  scopeHousehold,
  type PeopleViewer,
  type ScopedPresence,
} from '$lib/home/presence/viewer';

// The household room. Everyone who may open it — the owner and a household
// viewer — loads the same live cards through the same path, and
// `scopeHousehold` decides what each receives: the owner every card
// untouched; a household viewer everyone's live status, their own day, and
// nothing of anyone not sharing.
//
// Scoping is decided HERE and nowhere else (spec D2). The page cannot be
// trusted to hide anything: whatever this returns is in the browser.
//
// Everyone's movement is on this page too, filtered by `?person=` — the one
// page replaced a page per person (the old /home/people/[subject] forwards
// here). Movement goes only to people `mayOpenPerson` allows: the owner
// everyone's, a household viewer their own and their wards'. A `person` this
// viewer may not see is ignored, never an error, so the filter cannot be used
// to list the household.
interface Family {
  members: ScopedPresence[];
}

const EMPTY = (): Family => ({ members: [] });

/** Person pages this viewer may open — the page links only these. */
const linksFor = (family: Family, viewer: PeopleViewer): Record<string, string> =>
  personLinks(
    family.members.map((m) => m.subject),
    viewer,
  );

export const load: PageServerLoad = async (event) => {
  // The hook already turned away anyone who is neither; this is the second
  // lock, and the one that decides WHAT they get. Nothing is read before it.
  const viewer: PeopleViewer | null = await peopleViewerOf(event);
  if (!viewer) error(403, 'Forbidden');
  event.depends('home:people');

  // The map: every SHARING person's last fix (`livePositions` drops anyone not
  // sharing). The owner and any household viewer — that is what the Family
  // Circle is for. A failed read draws no map and costs nothing else.
  const positions: LivePosition[] = await livePositions().catch((err) => {
    console.error('[home/people] positions failed:', errMsg(err));
    return [];
  });

  // Movement, read only for people this viewer may see. The 30-second
  // refresh re-runs this load; `loadPeopleMovement` caches each trail for
  // five minutes, so only the live cards are re-read on that clock.
  const movement: PersonMovement[] = await listMembers()
    .then((all) => loadPeopleMovement(all.filter((m) => mayOpenPerson(viewer, m.subject)), { days: DEFAULT_WINDOW_DAYS }))
    .catch((err) => {
      console.error('[home/people] movement failed:', errMsg(err));
      return [];
    });
  const asked = event.url.searchParams.get('person');
  const person = asked && movement.some((p) => p.subject === asked) ? asked : null;
  // "Your day" is offered when the filter is on the viewer's OWN subject: it
  // is read from their phone, keyed on the session (see my-day.ts).
  const own = await ownDayOf(event).catch(() => null);
  const ownSubject = own?.subject ?? null;
  const moving = { movement, person, ownSubject, days: DEFAULT_WINDOW_DAYS };

  try {
    const { members } = await loadHousehold();
    const family: Family = { members: scopeHousehold(members, viewer) };
    const feedChecks = await loadFeedChecks(family.members.filter((m) => !m.notSharing).map((m) => m.subject))
      .catch((err) => {
        console.error('[home/people] feed checks failed:', errMsg(err));
        return {} as Record<string, FeedCheck>;
      });
    return { family, viewer, links: linksFor(family, viewer), loadError: null as string | null, positions, feedChecks, loadedAt: new Date(), ...moving };
  } catch (err) {
    console.error('[home/people] household load failed:', errMsg(err));
    // The error text can name tables and queries: the owner gets it, a
    // household viewer gets the fact of the failure.
    const loadError = viewer.kind === 'owner' ? errMsg(err) : 'The household could not be read just now.';
    return { family: EMPTY(), viewer, links: {} as Record<string, string>, loadError, positions, feedChecks: {} as Record<string, FeedCheck>, loadedAt: new Date(), ...moving };
  }
};
