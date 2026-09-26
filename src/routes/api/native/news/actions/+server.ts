import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { runScopedNewsAction } from '$lib/news/actions.server';
import { isNewsSource } from '$lib/constants/news-sources';
import { getNewsStory, isNewsStoryId } from '$lib/news/sources';
import { toggleNewsFavourite } from '$lib/news/favourites';

/**
 * POST /api/native/news/actions — favourite, keep, note, research.
 *
 * Deliberately the same four verbs and the same libraries as
 * `/api/news/actions`, not a subset: the whole point of a row action is that the
 * thing you do on the train is the thing that is there at the desk. It is a
 * separate FILE only because identity arrives differently — a paired device
 * rather than a browser session.
 *
 * Keep, note and research run through `runScopedNewsAction`, the web door's own
 * code, so a member's phone gets exactly what a member's browser gets: the
 * area's grant or a 403, their own space / notebook / run, and the daily
 * research cap. (This file used to call the libraries with their owner
 * defaults, which was only safe while the owner was the one thing that could
 * pair.) The owner's result is unchanged: the seam reads his sessionless
 * request as the owner and hands back the owner's scope.
 *
 * The error path deliberately diverges from the web endpoint's. That one
 * forwards `err.message.slice(0, 240)` so the desk can show what the graph or
 * the research commissioner actually said; here it would put internal detail on
 * a phone that has no way to act on it, so the wrapper flattens it to one
 * sentence and logs the rest. A REFUSAL (403, the cap's 429) is not flattened:
 * that sentence is written for a person.
 */
export const POST: RequestHandler = withNativeAccess('news', async (event, identity) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });

  const action = typeof body.action === 'string' ? body.action : '';
  const source = typeof body.source === 'string' ? body.source : '';
  const id = typeof body.id === 'string' ? body.id : '';
  if (!isNewsSource(source) || !isNewsStoryId(source, id)) {
    return json({ error: 'Unknown news story' }, { status: 400 });
  }

  if (action === 'favourite') {
    const story = await getNewsStory(source, id);
    return json(await toggleNewsFavourite(identity.ownerEmail, story));
  }

  return json(await runScopedNewsAction(event, action, source, id), { status: 201 });
});
