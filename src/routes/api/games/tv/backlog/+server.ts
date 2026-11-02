import type { RequestHandler } from './$types';
import { GameError } from '$lib/games/tap-duel';
import { partyBody, partyJson, requireTv } from '$lib/games/party-http.server';
import { getItem, loadItems } from '$lib/family/backlog.server';
import { prepareCast } from '$lib/family/backlog-cast.server';
import { listMembers } from '$lib/home/presence/members';
import { tvBacklogItems } from '$lib/games/tv-backlog.server';

/**
 * GET /api/games/tv/backlog — the family backlog's playable videos, for a
 * linked TV's Watch row. POST `{ id }` — get one ready to play: the same
 * answer the app's Play on TV gets (`ready` with a six-hour link, `preparing`,
 * or `fallback`). Public to the hook like every /api/games/tv route; 401 for
 * anything but a linked TV, which only the owner links.
 */
export const GET: RequestHandler = ({ cookies }) =>
  partyJson(async () => {
    await requireTv(cookies);
    const [items, members] = await Promise.all([loadItems(), listMembers().catch(() => [])]);
    const names = new Map(members.filter((m) => m.email).map((m) => [m.email as string, m.displayName.split(' ')[0]]));
    return { items: tvBacklogItems(items, names) };
  });

export const POST: RequestHandler = ({ cookies, request, url }) =>
  partyJson(async () => {
    await requireTv(cookies);
    const body = await partyBody(request);
    const item = typeof body.id === 'string' ? await getItem(body.id) : null;
    // Only what the list offers: a TV cannot fetch an idea, a page or a finished item by guessing its id.
    if (!item || item.status !== 'new') throw new GameError(404, 'That video is not on the list any more.');
    return prepareCast(item, url.origin);
  });
