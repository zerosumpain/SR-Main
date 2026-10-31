// `wishlist` toolset — things to buy. wishlist_add turns "I want X, under £Y,
// with Z" into a hunt (or, given a product link, a price watch) that the
// `wishlist-sweep` heartbeat checks against hotukdeals and PriceRunner;
// wishlist_list shows what is on it and the best listings found;
// wishlist_update pauses, settles or deletes an item. The page is /home/wishlist.
//
// Owner only (not member-safe): phase 1 lists are the owner's, and an item can
// name who a gift is for.
import { register } from '../registry-internal';
import { addWish } from '$lib/wishlist/add.server';
import { checkItem, rankOffers } from '$lib/wishlist/sweep.server';
import { deleteItem, getItem, listItems, listOffers, saveItem } from '$lib/wishlist/store.server';
import { describeConstraint, formatPence } from '$lib/wishlist/match';
import type { WishItem, WishStatus } from '$lib/wishlist/types';

const PAGE = '/home/wishlist';

function summary(item: WishItem) {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    title: item.title,
    forPerson: item.forPerson,
    deadline: item.deadline,
    ceiling: item.criteria.maxPricePence === null ? null : formatPence(item.criteria.maxPricePence),
    target: item.targetPricePence === null ? null : formatPence(item.targetPricePence),
    criteria: item.criteria.constraints.map(describeConstraint),
    lookingAt: item.kind === 'hunt' ? item.feeds.map((f) => `${f.source}:${f.value}`) : item.urls,
    lastCheckedAt: item.lastCheckedAt,
    lastError: item.lastError,
    url: `${PAGE}#${item.id}`,
  };
}

register({
  name: 'wishlist_add',
  effect: 'mutate',
  confirm: 'never',
  description:
    'Add something to the WISH LIST. Give the user\'s words: either criteria to HUNT for ("a gaming PC under £1,100 with 16GB DDR5 and an RTX 5060 or better, for Christmas") or a product link to WATCH for a price drop (optionally "tell me under £X"). The wish list checks hotukdeals and PriceRunner on a schedule and messages the user when a listing meets every criterion, nearly does, or a watched price falls. Returns what it understood — show the user the criteria so a misread can be fixed. Prefer this over monitor_create for anything that is shopping.',
  parameters: {
    type: 'object',
    properties: {
      ask: { type: 'string', description: 'What the user wants, in their own words — include price ceiling, required specs, who it is for and when it is needed by, and any product URL.' },
    },
    required: ['ask'],
  },
  category: 'Wish list',
  toolset: 'wishlist',
  handler: async (args) => {
    const ask = typeof args.ask === 'string' ? args.ask.trim() : '';
    if (!ask) return { success: false, error: 'ask is required' };
    try {
      const { item, dropped } = await addWish(ask);
      return { success: true, data: { item: summary(item), leftOut: dropped, note: 'The first check is running now; results appear on the page and by message.', page: PAGE } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'wishlist_add failed' };
    }
  },
});

register({
  name: 'wishlist_list',
  effect: 'read',
  description: 'List the wish list: each item\'s criteria and status, with the best listings found so far (verdict, price, merchant, link, and why it does or does not fit).',
  parameters: {
    type: 'object',
    properties: {
      includeSettled: { type: 'boolean', description: 'Include items marked bought or dropped. Default false.' },
    },
  },
  category: 'Wish list',
  toolset: 'wishlist',
  handler: async (args) => {
    try {
      const all = await listItems('owner');
      const items = args.includeSettled === true ? all : all.filter((i) => i.status === 'watching' || i.status === 'paused');
      const out = await Promise.all(
        items.map(async (item) => ({
          ...summary(item),
          best: rankOffers(await listOffers(item.id))
            .filter((o) => o.verdict !== 'no')
            .slice(0, 5)
            .map((o) => ({ verdict: o.verdict, price: formatPence(o.pricePence), merchant: o.merchant, title: o.title, url: o.url, why: o.results.map((r) => r.reason) })),
        })),
      );
      return { success: true, data: { count: out.length, items: out, page: PAGE } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'wishlist_list failed' };
    }
  },
});

const STATUSES: WishStatus[] = ['watching', 'paused', 'bought', 'dropped'];

register({
  name: 'wishlist_update',
  effect: 'mutate',
  confirm: 'never',
  description:
    'Change a wish list item: set its status (watching, paused, bought, dropped), run a check now, or delete it. Use the id from wishlist_list.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The item id (w_…).' },
      action: { type: 'string', enum: ['watching', 'paused', 'bought', 'dropped', 'check', 'delete'], description: 'A new status, "check" to look now, or "delete".' },
    },
    required: ['id', 'action'],
  },
  category: 'Wish list',
  toolset: 'wishlist',
  handler: async (args) => {
    const id = typeof args.id === 'string' ? args.id : '';
    const action = typeof args.action === 'string' ? args.action : '';
    try {
      const item = await getItem(id);
      if (!item) return { success: false, error: `no wish list item ${id}` };
      if (action === 'delete') return { success: true, data: { deleted: await deleteItem(id) } };
      if (action === 'check') {
        const res = await checkItem(item);
        return { success: true, data: { checked: res.candidates, kept: res.kept, alerts: res.events, errors: res.errors, page: `${PAGE}#${id}` } };
      }
      if (!STATUSES.includes(action as WishStatus)) return { success: false, error: `unknown action ${action}` };
      item.status = action as WishStatus;
      await saveItem(item);
      return { success: true, data: { item: summary(item) } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'wishlist_update failed' };
    }
  },
});
