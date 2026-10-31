// Adding to the wish list, from the page or (phase 1b) from jkai: compile the
// ask, prove the hotukdeals tags exist, save, and start the first check
// without waiting for it.
//
// Tags are checked here because a misremembered slug 404s for ever and the hunt
// would quietly read nothing. PriceRunner categories are not: from the VPS that
// read goes through the residential scraper and takes tens of seconds, so a bad
// one is left for the first sweep to report on the item.

import { compileWish } from './compile.server';
import { fetchHukdTag } from './sources/hukd';
import { checkItem } from './sweep.server';
import { newItemId, saveItem } from './store.server';
import type { WishItem } from './types';

export interface AddResult {
  item: WishItem;
  dropped: string[];
}

export async function addWish(ask: string, principalId = 'owner', now = new Date()): Promise<AddResult> {
  const compiled = await compileWish(ask, now);
  const dropped = [...compiled.dropped];

  const feeds = [];
  for (const f of compiled.feeds) {
    if (f.source === 'hukd-tag') {
      try {
        await fetchHukdTag(f.value);
      } catch {
        dropped.push(`hotukdeals tag "${f.value}" does not exist`);
        continue;
      }
    }
    feeds.push(f);
  }
  if (compiled.kind === 'hunt' && feeds.length === 0) {
    throw new Error('Could not find anywhere to look for that — try naming the kind of thing (e.g. "gaming PC", "air fryer").');
  }

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

  // The first read can take a minute through the residential scraper; the
  // page shows "checking…" until lastCheckedAt is set.
  void checkItem(item).catch((err) => console.error('[wishlist] first check failed:', err instanceof Error ? err.message : err));
  return { item, dropped };
}
