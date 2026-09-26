import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isNewsSource, isNewsStoryId } from '$lib/news/sources';
import { readNewsStory } from '$lib/news/reader';
import { isNewsFavourite, newsOwnerKey } from '$lib/news/favourites';
import { recordRead } from '$lib/news/store';
import { newsCapabilities } from '$lib/news/capabilities.server';

export const load: PageServerLoad = async (event) => {
  const { params, url, locals } = event;
  if (!isNewsSource(params.source) || !isNewsStoryId(params.source, params.id)) {
    throw error(404, 'News story not found');
  }
  try {
    const article = await readNewsStory(params.source, params.id, { force: url.searchParams.has('fresh') });
    const ownerKey = await newsOwnerKey(locals);
    // Opening the reader IS the read. Fire and forget — the signal is worth
    // collecting, but not at the cost of failing the page that collects it.
    void recordRead(ownerKey, article.story.key, article.story.source);
    return {
      article,
      isFavourite: await isNewsFavourite(ownerKey, article.story.key),
      can: await newsCapabilities(event),
    };
  } catch (err) {
    console.error('[news] story load failed:', err);
    throw error(502, 'The news source could not be reached');
  }
};
