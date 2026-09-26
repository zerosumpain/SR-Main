import type { RequestHandler } from './$types';
import { clampLimit, withNativeAccess } from '$lib/server/native-handler';
import { loadNewsDesk, parseNewsSort, parseNewsView } from '$lib/news/desk';
import { newsCapabilities } from '$lib/news/capabilities.server';

/**
 * GET /api/native/news — the desk, shaped for a 390pt screen.
 *
 * Same derivation as `/news`, different projection. Three things are cut, each
 * because the phone cannot use them:
 *
 *  * the story `summary`, which on the wire runs to a paragraph the ledger row
 *    never shows — the detail endpoint carries it;
 *  * `tags` and `canonicalUrl`, which are a grouping key and a facet the phone
 *    has no filter for;
 *  * the full correlation `names` list, trimmed to three, because the row draws
 *    at most three before it elides.
 *
 * `read` and `kept` arrive as booleans ON the row rather than as two separate
 * key arrays. The web desk holds Sets and tests membership while rendering a
 * table; a phone list re-renders per row and would rebuild that Set each time.
 *
 * A member's phone reads the desk as the web gives it to them: their own saved
 * and read stories (keyed on their email, as `newsOwnerKey` keys the web), and
 * none of John's material — no correlations, no kept-in-graph marks, no
 * retained counts (`ownerData`). `can` is the same capability set the web page
 * renders its row actions from, so the phone offers exactly what
 * `/api/native/news/actions` will then accept.
 */
export const GET: RequestHandler = withNativeAccess('news', async (event, identity) => {
  const { url } = event;
  const can = await newsCapabilities(event);
  const view = parseNewsView(url.searchParams.get('view'));
  const desk = await loadNewsDesk({
    view,
    sort: parseNewsSort(url.searchParams.get('sort'), view),
    // The phone's ledger is a scroll, not a table: 40 rows is a long thumb and
    // four wires' worth of fetch. The web desk's 100 is a ceiling for a screen
    // that can show a hundred rows at once.
    limit: clampLimit(url.searchParams.get('limit'), 40, 100),
    force: url.searchParams.has('fresh'),
    ownerKey: identity.ownerEmail,
    ownerData: can.ownerData,
  });

  const read = new Set(desk.readKeys);
  const kept = new Set(desk.keptKeys);

  return {
    view: desk.feed.view,
    sort: desk.sort,
    updatedAt: desk.feed.updatedAt,
    cached: desk.feed.cached ?? false,
    newSinceLast: desk.feed.newSinceLast,
    anchorCount: desk.anchorCount,
    stats: desk.stats,
    can: { graph: can.graph, research: can.research, note: can.note, ask: can.ask },
    sources: desk.feed.sources,
    stories: desk.feed.stories.map((story, index) => {
      const correlation = desk.correlations[story.key];
      return {
        key: story.key,
        source: story.source,
        sourceLabel: story.sourceLabel,
        id: story.id,
        title: story.title,
        url: story.url,
        discussionUrl: story.discussionUrl,
        domain: story.domain,
        author: story.author,
        publishedAt: story.publishedAt,
        score: story.score,
        commentCount: story.commentCount,
        heat: story.heat,
        // The ledger's own numeral, not the wire's rank — after `for-you` has
        // reordered, the wire's rank is the position the row is NOT in.
        rank: index + 1,
        read: read.has(story.key),
        kept: kept.has(story.key),
        alsoOn: story.alsoOn.map((also) => ({
          source: also.source,
          sourceLabel: also.sourceLabel,
          discussionUrl: also.discussionUrl,
          score: also.score,
          commentCount: also.commentCount,
        })),
        correlation: correlation
          ? {
              score: correlation.score,
              names: correlation.names.slice(0, 3),
              why: correlation.why,
              evidence: correlation.evidence,
            }
          : null,
      };
    }),
  };
});
