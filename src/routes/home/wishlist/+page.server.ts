import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { viewerOf } from '$lib/server/viewer';
import { addWish, rereadWish } from '$lib/wishlist/add.server';
import { checkItem, rankOffers } from '$lib/wishlist/sweep.server';
import { deleteItem, getItem, listItems, listOffers, saveItem } from '$lib/wishlist/store.server';
import { cadenceMs } from '$lib/wishlist/due';
import { compareRows, valueModel } from '$lib/wishlist/value';
import type { WishStatus } from '$lib/wishlist/types';

// The wish list: things to buy, each either a product watched for price or a
// hunt for listings that meet some criteria. Owner-only in phase 1 — the route
// is in no allow-list, so the hook keeps everyone else out, and the viewer
// check below is the second lock. Phase 2 opens it per person.

async function owner(event: Parameters<PageServerLoad>[0]): Promise<void> {
  if ((await viewerOf(event)).kind !== 'owner') error(403, 'The wish list is the owner\'s.');
}

export const load: PageServerLoad = async (event) => {
  await owner(event);
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const now = new Date();
  const items = await listItems('owner');
  const withOffers = await Promise.all(
    items.map(async (item) => {
      const offers = rankOffers(await listOffers(item.id));
      const shown = offers.filter((o) => o.verdict !== 'no').slice(0, 12);
      return {
        item,
        offers: shown,
        compare: compareRows(shown, item.criteria),
        factors: valueModel(item.criteria).map((f) => ({ label: f.label, weight: f.weight })),
        hidden: offers.filter((o) => o.verdict === 'no').length,
        nextCheckAt: item.lastCheckedAt ? new Date(Date.parse(item.lastCheckedAt) + cadenceMs(item, now)).toISOString() : null,
      };
    }),
  );
  return { items: withOffers, loadedAt: now.toISOString() };
};

async function ownerAction(event: Parameters<Actions[string]>[0]) {
  if ((await viewerOf(event)).kind !== 'owner') return fail(403, { error: 'The wish list is the owner\'s.' });
  return null;
}

const STATUSES: WishStatus[] = ['watching', 'paused', 'bought', 'dropped'];

export const actions: Actions = {
  add: async (event) => {
    const denied = await ownerAction(event);
    if (denied) return denied;
    const ask = String((await event.request.formData()).get('ask') ?? '').trim();
    if (!ask) return fail(400, { error: 'Say what you want.' });
    try {
      const { item, dropped } = await addWish(ask);
      return { added: item.id, dropped };
    } catch (err) {
      return fail(422, { error: err instanceof Error ? err.message : 'Could not add that.', ask });
    }
  },

  check: async (event) => {
    const denied = await ownerAction(event);
    if (denied) return denied;
    const item = await getItem(String((await event.request.formData()).get('id') ?? ''));
    if (!item) return fail(404, { error: 'That has gone from the list.' });
    const res = await checkItem(item);
    return { checked: item.id, events: res.events, errors: res.errors };
  },

  reread: async (event) => {
    const denied = await ownerAction(event);
    if (denied) return denied;
    const item = await getItem(String((await event.request.formData()).get('id') ?? ''));
    if (!item) return fail(404, { error: 'That has gone from the list.' });
    try {
      const { dropped } = await rereadWish(item);
      return { reread: item.id, dropped };
    } catch (err) {
      return fail(422, { error: err instanceof Error ? err.message : 'Could not re-read that.' });
    }
  },

  status: async (event) => {
    const denied = await ownerAction(event);
    if (denied) return denied;
    const form = await event.request.formData();
    const item = await getItem(String(form.get('id') ?? ''));
    const status = String(form.get('status') ?? '') as WishStatus;
    if (!item) return fail(404, { error: 'That has gone from the list.' });
    if (!STATUSES.includes(status)) return fail(400, { error: 'Unknown status.' });
    item.status = status;
    await saveItem(item);
    return { moved: item.id };
  },

  remove: async (event) => {
    const denied = await ownerAction(event);
    if (denied) return denied;
    const id = String((await event.request.formData()).get('id') ?? '');
    if (!(await deleteItem(id))) return fail(404, { error: 'That has gone from the list.' });
    return { removed: id };
  },
};
