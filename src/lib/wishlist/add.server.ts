// Adding to the wish list, from the page or (phase 1b) from jkai: compile the
// ask, prove the hotukdeals tags exist, save, and start the first check
// without waiting for it.
//
// Tags and Overclockers categories are checked here because a misremembered
// path 404s for ever and the hunt would quietly read nothing. Scan categories
// and subreddits need no check — they come from closed lists. PriceRunner
// categories are not checked: from the VPS that
// read goes through the residential scraper and takes tens of seconds, so a bad
// one is left for the first sweep to report on the item.

import { compileWish } from './compile.server';
import { fetchHukdTag } from './sources/hukd';
import { fetchPageScripts } from './sources/fetch.server';
import { ocukCategoryUrl, parseOcukItemList } from './sources/ocuk';
import { checkItem } from './sweep.server';
import { newItemId, saveItem } from './store.server';
import type { FeedRef, WishItem } from './types';

export interface AddResult {
  item: WishItem;
  dropped: string[];
}

/** Compile an ask and keep only the feeds that resolve. */
async function compileChecked(ask: string, now: Date) {
  const compiled = await compileWish(ask, now);
  const dropped = [...compiled.dropped];

  const feeds: FeedRef[] = [];
  for (const f of compiled.feeds) {
    if (f.source === 'hukd-tag') {
      try {
        await fetchHukdTag(f.value);
      } catch {
        dropped.push(`hotukdeals tag "${f.value}" does not exist`);
        continue;
      }
    }
    if (f.source === 'ocuk-cat') {
      // Overclockers answers the VPS directly in about a second, so a guessed
      // path is checked the same way a tag is.
      const ok = await fetchPageScripts(ocukCategoryUrl(f.value))
        .then((p) => parseOcukItemList(p.ld).length > 0)
        .catch(() => false);
      if (!ok) {
        dropped.push(`Overclockers category "${f.value}" lists nothing`);
        continue;
      }
    }
    feeds.push(f);
  }
  if (compiled.kind === 'hunt' && feeds.length === 0) {
    throw new Error('Could not find anywhere to look for that — try naming the kind of thing (e.g. "gaming PC", "air fryer").');
  }
  return { compiled, feeds, dropped };
}

// The first read can take a minute through the residential scraper; the
// page shows "checking…" until lastCheckedAt is set.
const checkInBackground = (item: WishItem) =>
  void checkItem(item).catch((err) => console.error('[wishlist] check failed:', err instanceof Error ? err.message : err));

export async function addWish(ask: string, principalId = 'owner', now = new Date()): Promise<AddResult> {
  const { compiled, feeds, dropped } = await compileChecked(ask, now);
  const item: WishItem = {
    id: newItemId(),
    principalId,
    kind: compiled.kind,
    status: 'watching',
    title: compiled.title,
    ask: ask.trim().slice(0, 2_000),
    criteria: compiled.criteria,
    feeds,
    urls: compiled.urls,
    targetPricePence: compiled.targetPricePence,
    forPerson: compiled.forPerson,
    deadline: compiled.deadline,
    createdAt: now.toISOString(),
    lastCheckedAt: null,
    lastSearchedAt: null,
    lastError: null,
  };
  await saveItem(item);
  checkInBackground(item);
  return { item, dropped };
}

/**
 * Read an item's ask again — for when the engine has learned new places to
 * look (an item added before Overclockers was a source never asks it). Keeps
 * the item's id, status and listings; replaces what it understood and where it
 * looks, then checks it.
 */
export async function rereadWish(item: WishItem, now = new Date()): Promise<AddResult> {
  const { compiled, feeds, dropped } = await compileChecked(item.ask, now);
  Object.assign(item, {
    kind: compiled.kind,
    title: compiled.title,
    criteria: compiled.criteria,
    feeds,
    urls: compiled.urls,
    targetPricePence: compiled.targetPricePence,
    forPerson: compiled.forPerson,
    deadline: compiled.deadline,
    lastSearchedAt: null,
    lastError: null,
  });
  await saveItem(item);
  checkInBackground(item);
  return { item, dropped };
}
