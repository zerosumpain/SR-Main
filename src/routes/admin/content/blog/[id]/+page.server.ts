import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadHistory } from '$lib/blog/assistant/messages';
import { getVoiceCard } from '$lib/voice/card';
import { readStatsForPost } from '$lib/blog/analytics.server';
import { getUmami } from '$lib/umami/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const id = parseInt(params.id);
  if (isNaN(id)) throw error(400, 'Invalid ID');

  const [post] = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      content: blogPosts.content,
      coverImageUrl: blogPosts.coverImageUrl,
      // All three are edited by the page and were absent from this select:
      // `coverImageAlt` had no writer at all until now, `bodyFont` is new, and
      // `authorship` is read by the autopilot pass to decide whether a post is
      // still corpus-eligible.
      coverImageAlt: blogPosts.coverImageAlt,
      contentFormat: blogPosts.contentFormat,
      bodyFont: blogPosts.bodyFont,
      authorship: blogPosts.authorship,
      previewToken: blogPosts.previewToken,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1);
  if (!post) throw error(404, 'Post not found');

  const tags = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, id));

  const history = await loadHistory(post.id);

  const umami = getUmami();
  const path = `/blog/${post.slug}`;

  // NULL when Umami is not configured — which is every non-production host,
  // since the UMAMI_* vars are VPS-only. The card must be able to say "not
  // configured" rather than print a row of zeros, and a partially-null object
  // cannot express that: the client swallows every error and returns
  // `{ pageviews: 0, visitors: 0 }`, so a dead container already looks exactly
  // like an unread post. One null is the only honest shape.
  const stats = umami
    ? await Promise.all([
        umami.getStatsForPath(path, 30),
        umami.getStatsForPath(path, 365 * 5),
        umami.getDailyViews(path, 30),
        umami.getTopReferrers(path, 30, 5),
      ]).then(([stats30d, statsLifetime, daily, referrers]) => ({
        stats30d,
        statsLifetime,
        daily,
        referrers,
        available: true,
      }))
    : null;

  // First-party reading figures — dwell, completion, scroll depth. Umami cannot
  // answer any of these: it reports time-on-page only as a site-wide average
  // derived from the gap between two pageviews, and a post that is opened, read
  // and closed produces exactly one. Null rather than a zero object when the
  // read fails, so the card can tell "no data" from "nobody read it".
  const reads = await readStatsForPost(post.id, 30).catch((e) => {
    console.error('[blog] read stats failed:', e);
    return null;
  });

  return {
    post: { ...post, tags: tags.map((t) => t.tag) },
    history,
    reads,
    // The editor scores in the browser as the author types, so the card travels
    // with the page rather than costing a request per keystroke.
    voiceCard: getVoiceCard(),
    stats,
  };
};
