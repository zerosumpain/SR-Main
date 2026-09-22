import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import {
  commissionNewsResearch,
  keepNewsInGraph,
  linkNewsInNote,
  newsActionArticle,
} from '$lib/news/actions';
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
 * rather than a browser session — and `newsOwnerKey(locals)` cannot see one.
 *
 * The error path deliberately diverges from the web endpoint's. That one
 * forwards `err.message.slice(0, 240)` so the desk can show what the graph or
 * the research commissioner actually said; here it would put internal detail on
 * a phone that has no way to act on it, so `withDevice` flattens it to one
 * sentence and logs the rest.
 */
export const POST: RequestHandler = withDevice(async ({ request }, identity) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
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

  const article = await newsActionArticle(source, id);
  if (action === 'graph') return json(await keepNewsInGraph(article), { status: 201 });
  if (action === 'note') return json(await linkNewsInNote(article), { status: 201 });
  if (action === 'research') return json(await commissionNewsResearch(article), { status: 201 });
  return json({ error: 'Unknown news action' }, { status: 400 });
});
