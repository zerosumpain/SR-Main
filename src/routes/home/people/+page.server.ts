import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadFamily } from '$lib/daydream/ledger';

// The household room loads one thing: the family ledger.
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
