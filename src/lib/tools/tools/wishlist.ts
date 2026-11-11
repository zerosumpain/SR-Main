// `wishlist` toolset — things to buy. wishlist_add turns "I want X, under £Y,
// with Z" into a hunt (or, given a product link, a price watch) that the
// `wishlist-sweep` heartbeat checks against hotukdeals, PriceRunner,
// Overclockers, Scan and r/buildapcsalesuk; wishlist_list shows what is on it and the best listings found;
// wishlist_update pauses, settles, re-reads or deletes an item. The page is /home/wishlist.
//
// Owner only (not member-safe): phase 1 lists are the owner's, and an item can
// name who a gift is for.
import { register } from '../registry-internal';
import { addWish, rereadWish } from '$lib/wishlist/add.server';
import { checkItem, rankOffers, sweepWishlist } from '$lib/wishlist/sweep.server';
import { compareRows } from '$lib/wishlist/value';
import { refuseUnlessOwner } from './owner-only';
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
    'Add something to the WISH LIST. Works for ANY kind of thing — electronics, holidays, toys, appliances, PCs. Give the user\'s words: either criteria to HUNT for ("a 55in+ TV under £600", "a 4-star family week in the sun under £2,000 for four", "a gaming PC under £1,100 with an RTX 5060 or better") or a product link to WATCH for a price drop (optionally "tell me under £X"). The wish list checks hotukdeals, PriceRunner, HolidayPirates and (for PCs) Overclockers, Scan and r/buildapcsalesuk on a schedule and messages the user when a listing meets every criterion, nearly does, or a watched price falls. Returns what it understood — show the user the criteria so a misread can be fixed. Prefer this over monitor_create for anything that is shopping.',
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
    'Change a wish list item: set its status (watching, paused, bought, dropped), run a check now, "reread" its ask (picks up sources added since it was made), or delete it. Use the id from wishlist_list.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The item id (w_…).' },
      action: { type: 'string', enum: ['watching', 'paused', 'bought', 'dropped', 'check', 'reread', 'delete'], description: 'A new status, "check" to look now, "reread" to re-read the ask, or "delete".' },
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
      if (action === 'reread') {
        const { dropped } = await rereadWish(item);
        return { success: true, data: { item: summary(item), leftOut: dropped, page: `${PAGE}#${id}` } };
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

// Workflow knit 2026-11-11: the comparison a wish's page shows, and the sweep
// its button runs.
register({
  name: 'wishlist_offers',
  effect: 'read',
  description:
    'Every listing found for one wish, compared as the wish\'s page compares them: price held against the budget, the verdict, how each listing reads on the factors that matter, the dates a trip listing states, and a value index (best listing = 100). Takes the wish id from wishlist_list. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The wish id, from wishlist_list.' },
      limit: { type: 'number', minimum: 1, maximum: 30, description: 'Most listings. Default 12.' },
    },
    required: ['id'],
  },
  category: 'Wish list',
  toolset: 'wishlist',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('wishlist_offers', ctx);
    if (refused) return refused;
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id || id.length > 120) return { success: false, error: 'id is required' };
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(30, Math.trunc(args.limit))) : 12;
    try {
      const item = await getItem(id);
      if (!item) return { success: false, error: `No wish ${id}` };
      const offers = rankOffers(await listOffers(id)).filter((o) => !o.expired);
      const rows = compareRows(offers, item.criteria)
        .slice(0, limit)
        .map((r) => ({
          title: r.title.slice(0, 160),
          url: r.url,
          merchant: r.merchant,
          price: r.priceLabel,
          ...(r.priceNote ? { priceNote: r.priceNote } : {}),
          verdict: r.verdict,
          ...(r.when ? { when: r.when } : {}),
          value: r.value,
          coverage: r.coverage,
          factors: r.factors.slice(0, 8),
        }));
      return { success: true, data: { ...summary(item), found: offers.length, offers: rows, page: PAGE } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'wishlist_offers failed' };
    }
  },
});

register({
  name: 'wishlist_sweep',
  effect: 'mutate',
  confirm: 'light',
  description:
    'Check every wish that is due now: search the sources again, keep the listings that fit and alert on a new good one, as the wish list\'s "Check all" does. Takes a minute or more. Use when John asks to refresh or re-check the whole wish list.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Wish list',
  toolset: 'wishlist',
  surfaces: ['chat', 'app'],
  handler: async (_args, ctx) => {
    const refused = refuseUnlessOwner('wishlist_sweep', ctx);
    if (refused) return refused;
    try {
      const out = await sweepWishlist();
      return {
        success: true,
        data: {
          due: out.due,
          checked: out.checked.map((c) => ({ id: c.itemId, candidates: c.candidates, kept: c.kept, notified: c.notified, errors: c.errors.slice(0, 3).map((e) => e.slice(0, 200)) })),
          page: PAGE,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'wishlist_sweep failed' };
    }
  },
});
