import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/home/presence/types';
import { livePositions, loadHousehold, type LivePosition } from '$lib/home/presence/household';
import {
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

  // The map: every SHARING person's last fix (`livePositions` drops anyone not
  // sharing). The owner and any household viewer — that is what the Family
  // Circle is for. A failed read draws no map and costs nothing else.
  const positions: LivePosition[] = await livePositions().catch((err) => {
    console.error('[home/people] positions failed:', errMsg(err));
    return [];
  });

  try {
    const { members } = await loadHousehold();
    const family: Family = { members: scopeHousehold(members, viewer) };
    return { family, viewer, links: linksFor(family, viewer), loadError: null as string | null, positions };
  } catch (err) {
    console.error('[home/people] household load failed:', errMsg(err));
    // The error text can name tables and queries: the owner gets it, a
    // household viewer gets the fact of the failure.
    const loadError = viewer.kind === 'owner' ? errMsg(err) : 'The household could not be read just now.';
    return { family: EMPTY(), viewer, links: {} as Record<string, string>, loadError, positions };
  }
};
