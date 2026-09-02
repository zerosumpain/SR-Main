import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  commissionNewsResearch,
  keepNewsInGraph,
  linkNewsInNote,
  newsActionArticle,
} from '$lib/news/actions';
import { getNewsStory, isNewsSource, isNewsStoryId } from '$lib/news/sources';
import { newsOwnerKey, toggleNewsFavourite } from '$lib/news/favourites';

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  const action = typeof body.action === 'string' ? body.action : '';
  const source = typeof body.source === 'string' ? body.source : '';
  const id = typeof body.id === 'string' ? body.id : '';
  if (!isNewsSource(source) || !isNewsStoryId(source, id)) {
    return json({ error: 'Unknown news story' }, { status: 400 });
  }

  try {
    if (action === 'favourite') {
      const [ownerKey, story] = await Promise.all([
        newsOwnerKey(locals),
        getNewsStory(source, id),
      ]);
      return json(await toggleNewsFavourite(ownerKey, story));
    }
    const article = await newsActionArticle(source, id);
    if (action === 'graph') return json(await keepNewsInGraph(article), { status: 201 });
    if (action === 'note') return json(await linkNewsInNote(article), { status: 201 });
    if (action === 'research') return json(await commissionNewsResearch(article), { status: 201 });
    return json({ error: 'Unknown news action' }, { status: 400 });
  } catch (err) {
    console.error(`[news] ${action || 'unknown'} action failed:`, err);
    return json(
      { error: err instanceof Error ? err.message.slice(0, 240) : 'News action failed' },
      { status: 500 },
    );
  }
};
