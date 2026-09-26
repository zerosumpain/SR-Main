import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadFamily } from '$lib/daydream/ledger';
import { loadHousehold } from '$lib/home/presence/household';
import { peopleViewerOf, scopeHousehold, type PeopleViewer, type ScopedPresence } from '$lib/home/presence/viewer';

// The household room. The owner loads the family ledger — the live cards plus
// what the daydream sweep has made of each person. A household viewer loads
// the live cards only, scoped by `scopeHousehold`: the sweep's hypotheses and
// thoughts are the owner's notes, and someone else's day is theirs.
//
// Scoping is decided HERE and nowhere else (spec D2). The page cannot be
// trusted to hide anything: whatever this returns is in the browser.
type Detail = Awaited<ReturnType<typeof loadFamily>>['detail'];
interface Family {
  members: ScopedPresence[];
  detail: Detail;
}

// The same keys on the failure path, so `PageData` is one shape rather than a
// union the markup has to narrow before it can read `detail`.
const EMPTY = (): Family => ({ members: [], detail: {} });

export const load: PageServerLoad = async (event) => {
  // The hook already turned away anyone who is neither; this is the second
  // lock, and the one that decides WHAT they get.
  const viewer: PeopleViewer | null = await peopleViewerOf(event);
  if (!viewer) error(403, 'Forbidden');

  if (viewer.kind === 'owner') {
    try {
      const family: Family = await loadFamily();
      return { family, viewer, loadError: null as string | null };
    } catch (err) {
      console.error('[daydream] family load failed:', errMsg(err));
      return { family: EMPTY(), viewer, loadError: errMsg(err) };
    }
  }

  try {
    const { members } = await loadHousehold();
    const family: Family = { members: scopeHousehold(members, viewer), detail: {} };
    return { family, viewer, loadError: null as string | null };
  } catch (err) {
    console.error('[home/people] household load failed:', errMsg(err));
    // The error text can name tables and queries; a household viewer gets the
    // fact of the failure, not the detail.
    return { family: EMPTY(), viewer, loadError: 'The household could not be read just now.' };
  }
};
