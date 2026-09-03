import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import {
  loadDelivery,
  loadDetectorRows,
  loadFeedCell,
  loadFeedMatrix,
  loadThoughtById,
  type FeedMatrix,
  type FeedRow,
  type LedgerThought,
} from '$lib/daydream/ledger';
import { listSteers } from '$lib/daydream/hypotheses/steer';
import { FAMILIES, FEED_STATES, type FeedState } from '$lib/daydream/thought-groups';

// The feed: a matrix of families × reader states over the WHOLE ledger, and
// the rows behind the one cell the URL names. `?f=` is a family, `?s=` a
// state; neither means the undecided column across every family. `?open=`
// (or a notification's `?rate=`) names a thought to open in the drill, which
// may sit outside the selected cell — so it is fetched on its own.
export const load: PageServerLoad = async ({ url, parent }) => {
  const f = url.searchParams.get('f');
  const s = url.searchParams.get('s');
  const family = f && f in FAMILIES ? f : null;
  const state = FEED_STATES.some((x) => x.id === s) ? (s as FeedState) : null;
  const openId = url.searchParams.get('open') ?? url.searchParams.get('rate');

  const empty: FeedMatrix = { rows: [], cols: [], cells: {}, total: 0 };
  try {
    // The threshold is already on the layout (`counts.threshold`); reading it
    // again here would scan every rated row a second time per arrival.
    const [{ counts }, matrix, rows, detectors, delivery, steers] = await Promise.all([
      parent(),
      loadFeedMatrix(),
      loadFeedCell(family, state),
      loadDetectorRows(),
      loadDelivery(),
      listSteers(),
    ]);
    const threshold = counts.threshold;
    let opened: LedgerThought | null = null;
    if (openId && !rows.some((r) => r.id === openId)) opened = await loadThoughtById(openId);
    return { matrix, family, state, rows, threshold, detectors, delivery, steers, opened, loadError: null as string | null };
  } catch (err) {
    console.error('[daydream] feed load failed:', errMsg(err));
    return {
      matrix: empty,
      family,
      state,
      rows: [] as FeedRow[],
      threshold: { value: 0, feedbackCount: 0 },
      detectors: [] as Awaited<ReturnType<typeof loadDetectorRows>>,
      delivery: null as Awaited<ReturnType<typeof loadDelivery>> | null,
      steers: [] as Awaited<ReturnType<typeof listSteers>>,
      opened: null as LedgerThought | null,
      loadError: errMsg(err),
    };
  }
};
