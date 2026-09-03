import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadDiscoveries, loadLatestDigest } from '$lib/daydream/ledger';

type Loaded = Awaited<ReturnType<typeof loadDiscoveries>>;
/** `sweep` is the last sweep PULSE, and there has not always been one —
 *  `lastPulseFor` hands back the first row of a query that can be empty. */
type Discoveries = Omit<Loaded, 'sweep'> & { sweep: Loaded['sweep'] | null };

/** The same keys with nothing in them, so the union the page sees carries
 *  every field whether the query answered or not. */
const EMPTY: Discoveries = { board: [], digests: [], leads: [], sweep: null };

/**
 * The room's own load, and nothing the layout already has.
 *
 * The hypothesis board is EAGER here. The monolith fetched it on demand
 * through `POST hypothesis_board` behind an "Open the board" button, which
 * meant the room's headline object arrived one round-trip after the page and
 * could not be summarised above the fold. `loadDiscoveries()` already calls
 * the same `loadBoard(120, null)` that the API action calls, so the board
 * comes back with the leads, the digests and the sweep in one pass rather
 * than as a second query.
 *
 * What stays on demand: `hypothesis_detail` (up to 120 paired days per
 * question), `lead_detail` (a lead can carry two hundred trace steps) and
 * `rate_question`. Those are per-row and most rows are never opened.
 *
 * The two loads fail independently: the digest is a single row and the
 * discoveries bundle is four queries, and losing one should not blank the
 * other.
 */
export const load: PageServerLoad = async () => {
  const errors: string[] = [];

  const [discoveries, digest] = await Promise.all([
    loadDiscoveries().catch((err) => {
      console.error('[daydream] discoveries load failed:', errMsg(err));
      errors.push(`the board, the lines and the sweep: ${errMsg(err)}`);
      return EMPTY;
    }),
    loadLatestDigest().catch((err) => {
      console.error('[daydream] discoveries digest load failed:', errMsg(err));
      errors.push(`yesterday's card: ${errMsg(err)}`);
      return null;
    }),
  ]);

  return {
    discoveries,
    digest,
    loadError: errors.length ? errors.join(' · ') : (null as string | null),
  };
};
