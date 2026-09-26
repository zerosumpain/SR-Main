import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { newsCapabilities } from '$lib/news/capabilities.server';
import { isNewsSource } from '$lib/constants/news-sources';
import { isNewsStoryId } from '$lib/news/sources';
import { readNewsStory } from '$lib/news/reader';
import { isNewsFavourite } from '$lib/news/favourites';
import { recordRead } from '$lib/news/store';

/**
 * GET /api/native/news/story/[source]/[id] — one story, read.
 *
 * Opening the detail IS the read event, which is why `recordRead` fires here
 * rather than from a separate call the phone would have to remember to make. The
 * web desk records on navigation for the same reason.
 *
 * `mode` is the field the app actually branches on: `submission` means the wire
 * IS the content, `external` means there is nothing to render natively and the
 * article must open outside, and anything else carries extracted text. Sending
 * empty content with no mode would make "we could not fetch it" and "it has no
 * body" the same thing on screen.
 *
 * Saved and read are keyed on the holder's email, owner or member, as the web
 * reader keys them on the session's. `can` travels with the story for the same
 * reason it does on the desk: the detail screen's actions are the row's.
 */
export const GET: RequestHandler = withNativeAccess('news', async (event, identity) => {
  const { params, url } = event;
  const { source, id } = params;
  if (!isNewsSource(source) || !isNewsStoryId(source, id)) {
    return json({ error: 'Unknown news story' }, { status: 404 });
  }

  const article = await readNewsStory(source, id, { force: url.searchParams.has('fresh') });
  const key = `${source}:${id}`;
  const [favourite, can] = await Promise.all([isNewsFavourite(identity.ownerEmail, key), newsCapabilities(event)]);

  // Best-effort, and deliberately not awaited into the response: a failed read
  // stamp must not cost the reader the article.
  void recordRead(identity.ownerEmail, key, source).catch(() => {});

  return {
    story: {
      key,
      source: article.story.source,
      sourceLabel: article.story.sourceLabel,
      id: article.story.id,
      title: article.story.title,
      url: article.story.url,
      discussionUrl: article.story.discussionUrl,
      domain: article.story.domain,
      author: article.story.author,
      publishedAt: article.story.publishedAt,
      score: article.story.score,
      commentCount: article.story.commentCount,
      heat: article.story.heat,
      alsoOn: article.story.alsoOn,
    },
    mode: article.mode,
    contentTitle: article.contentTitle,
    content: article.content,
    summary: article.summary,
    finalUrl: article.finalUrl,
    truncated: article.truncated,
    message: article.message,
    favourite,
    can: { graph: can.graph, research: can.research, note: can.note, ask: can.ask },
  };
});
