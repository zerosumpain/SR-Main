import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isNewsSource, isNewsStoryId } from '$lib/news/sources';
import { readNewsStory } from '$lib/news/reader';
import { isNewsFavourite, newsOwnerKey } from '$lib/news/favourites';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  if (!isNewsSource(params.source) || !isNewsStoryId(params.source, params.id)) {
    throw error(404, 'News story not found');
  }
  try {
    const article = await readNewsStory(params.source, params.id, { force: url.searchParams.has('fresh') });
    const ownerKey = await newsOwnerKey(locals);
    return {
      article,
      isFavourite: await isNewsFavourite(ownerKey, article.story.key),
    };
  } catch (err) {
    console.error('[news] story load failed:', err);
    throw error(502, 'The news source could not be reached');
  }
};
