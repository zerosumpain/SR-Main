// src/lib/nav/chat-tools.ts
//
// jkai's site tools (workflow knit 2026-11-11, slice 3): where things are on
// the site, and how a page is read.
//
//   site_map         the pages of the site as the map lists them, or the ones a
//                    few words name
//   site_analytics   page views and visitors for one path, from the analytics
//                    service the site already queries
//
// `site_map` is `placesFor` and `matchPlaces` from `./go`, the same pure
// functions the map's box uses, read as the owner: nothing is derived from the
// route tree. `site_analytics` is the existing analytics client (`$lib/umami`);
// it answers counts only, and says so plainly when the client is not
// configured on this host.
//
// Owner-only, not member-safe. Registered from here (src/hooks.server.ts
// imports this module at boot).

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { matchPlaces, placesFor } from './go';
import { getUmami } from '$lib/umami/client';

const int = (raw: unknown, min: number, max: number, fallback: number) =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.trunc(raw))) : fallback;
const PATH = /^\/[A-Za-z0-9/_.~-]{0,200}$/;

register({
  name: 'site_map',
  description:
    'Where things are on the site: every page the map lists, with its name, address and the room or section it is filed under. Give a few words to get the pages they name ("health plan", "wish list"), or nothing for the whole map. Use it to link John to the right page. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Optional words naming a page.' },
      limit: { type: 'number', minimum: 1, maximum: 200, description: 'Most pages. Default 12 with words, 120 without.' },
    },
    required: [],
  },
  category: 'Site',
  toolset: 'site',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('site_map', ctx);
    if (refused) return refused;
    const q = typeof args.q === 'string' ? args.q.trim().slice(0, 120) : '';
    const all = placesFor(true);
    const found = q ? matchPlaces(q, all) : all;
    const pages = found.slice(0, int(args.limit, 1, 200, q ? 12 : 120)).map((p) => ({ name: p.label, url: p.href, under: p.context }));
    return { success: true, data: { total: all.length, matched: found.length, pages, message: pages.length ? undefined : 'No page is named that.' } };
  },
});

register({
  name: 'site_analytics',
  description:
    'How one page of the site is read: page views and visitors over a window, the views a day and the top referrers, from the site\'s analytics. Takes a path (default "/", the front page). Counts only: nothing about who a visitor is. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The page path, starting with "/". Default "/".' },
      days: { type: 'number', minimum: 1, maximum: 90, description: 'Window in days. Default 7.' },
    },
    required: [],
  },
  category: 'Site',
  toolset: 'site',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('site_analytics', ctx);
    if (refused) return refused;
    const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '/';
    if (!PATH.test(path)) return { success: false, error: 'path must be a site path starting with "/".' };
    const days = int(args.days, 1, 90, 7);
    const umami = getUmami();
    if (!umami) return { success: false, error: 'Analytics is not configured on this host.' };
    try {
      const [stats, daily, referrers] = await Promise.all([umami.getStatsForPath(path, days), umami.getDailyViews(path, days), umami.getTopReferrers(path, days, 8)]);
      return { success: true, data: { path, days, pageviews: stats.pageviews, visitors: stats.visitors, daily: daily.slice(-90), referrers } };
    } catch (err) {
      return { success: false, error: `site_analytics could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  },
});
