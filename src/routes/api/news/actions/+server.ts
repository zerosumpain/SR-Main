import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  commissionNewsResearch,
  keepNewsInGraph,
  linkNewsInNote,
  newsActionArticle,
} from '$lib/news/actions';
import { getNewsStory, isNewsSource, isNewsStoryId } from '$lib/news/sources';
import { newsOwnerKey, toggleNewsFavourite } from '$lib/news/favourites';
import { newsCapabilities } from '$lib/news/capabilities.server';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import { writeSpace } from '$lib/jkai/intel/scope';
import { areaAccess } from '$lib/server/area-scope';
import { reserveResearchStart } from '$lib/deepdive/session-access.server';

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
    // Each action writes into another area: it needs that area's grant, and
    // lands in the caller's own space there, never the owner's.
    const can = await newsCapabilities(event);
    if (!['graph', 'note', 'research'].includes(action)) {
      return json({ error: 'Unknown news action' }, { status: 400 });
    }
    if (!can[action as 'graph' | 'note' | 'research']) {
      return json({ error: 'Your access does not include that.' }, { status: 403 });
    }
    if (action === 'research') {
      const access = await areaAccess(event, 'research');
      await reserveResearchStart(access, 'brief');
      const article = await newsActionArticle(source, id);
      return json(await commissionNewsResearch(article, access.own), { status: 201 });
    }
    const article = await newsActionArticle(source, id);
    if (action === 'graph') {
      const scope = await resolveRequestScope(event, 'own');
      return json(await keepNewsInGraph(article, { scope, spaceId: writeSpace(scope) }), { status: 201 });
    }
    return json(await linkNewsInNote(article), { status: 201 });
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
