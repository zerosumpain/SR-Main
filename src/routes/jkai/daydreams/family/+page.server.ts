import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadFamily } from '$lib/daydream/ledger';

// The household room loads ONE thing: the family ledger. Positions are not in
// it and never will be — a lat/lon leaves the server only through the
// on-demand `family_now` action, for one owner-gated render, which is why the
// map on this page fetches after mount rather than arriving in the payload.
type Family = Awaited<ReturnType<typeof loadFamily>>;

// The same keys on the failure path, so `PageData` is one shape rather than a
// union the markup has to narrow before it can read `detail`.
const EMPTY: Family = { members: [], detail: {} };

export const load: PageServerLoad = async () => {
  try {
    return { family: await loadFamily(), loadError: null as string | null };
  } catch (err) {
    console.error('[daydream] family load failed:', errMsg(err));
    return { family: EMPTY, loadError: errMsg(err) };
  }
};
