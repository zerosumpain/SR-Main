import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNewsStory, isNewsSource, isNewsStoryId } from '$lib/news/sources';
import { newsOwnerKey, toggleNewsFavourite } from '$lib/news/favourites';
import { runScopedNewsAction } from '$lib/news/actions.server';

export const POST: RequestHandler = async (event) => {
  const { request, locals } = event;
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
    // Each other action writes into another area: it needs that area's grant,
    // and lands in the caller's own space there, never the owner's. Shared with
    // the iPhone's door (`$lib/news/actions.server`).
    return json(await runScopedNewsAction(event, action, source, id), { status: 201 });
  } catch (err) {
    // A refusal (the research cap, a scope check) is an answer, not a failure.
    if (isHttpError(err)) return json({ error: err.body.message }, { status: err.status });
    console.error(`[news] ${action || 'unknown'} action failed:`, err);
    return json(
      { error: err instanceof Error ? err.message.slice(0, 240) : 'News action failed' },
      { status: 500 },
    );
  }
};
