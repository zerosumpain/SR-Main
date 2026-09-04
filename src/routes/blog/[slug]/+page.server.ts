import { getPostBySlug } from '$lib/blog';
import { renderArticle } from '$lib/blog/renderer';
import { stripReferences } from '$lib/blog/references';
import { bodyFontVar } from '$lib/blog/fonts';
import { publishedComments } from '$lib/blog/comments.server';
import { isOwnerRequest } from '$lib/server/owner';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const post = await getPostBySlug(event.params.slug);

  if (!post) {
    throw error(404, 'Post not found');
  }

  // Rendered HERE rather than in the component. `renderContent` pulls in
  // sanitize-html, marked and highlight.js; calling it from the .svelte file
  // put all three in the client bundle to produce markup the server had
  // already produced. The outline is a by-product of the same pass.
  const article = renderArticle(post.content, post.contentFormat);

  const owner = await isOwnerRequest(event).catch(() => false);

  // One URL, two documents. The owner gets a moderation strip and no reading
  // beacon; everyone else gets neither. Without these headers cloudflared can
  // serve the owner's copy to the next anonymous reader.
  event.setHeaders({ Vary: 'Cookie' });
  if (owner) event.setHeaders({ 'Cache-Control': 'private, no-store' });

  const comments = await publishedComments(post.id).catch((e) => {
    // A missing comments table (a deploy where the schema push has not landed
    // yet) must not 500 the article. The post is the point.
    console.error('[blog] comments load failed:', e);
    return [];
  });

  // Reading time is computed HERE, and `content` is then dropped from the
  // payload. The page renders `articleHtml`; shipping the raw body as well sent
  // every post down the wire twice — once as source and once as rendered
  // markup — to produce a single number.
  // Counted over the PROSE. The sources block is a list of URLs and counting it
  // inflates the estimate for a well-cited post — the same reason the
  // readability score and the segmenter strip it.
  const wordCount = stripReferences(post.content)
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount / 220));
  const { content: _body, previewToken: _token, ...postMeta } = post;

  return {
    post: postMeta,
    readingTime,
    articleHtml: article.html,
    toc: article.toc,
    // Rendered in the article FOOTER, not in the reading column. Null when the
    // post cites nothing. See $lib/blog/references.
    references: article.references,
    bodyFontVar: bodyFontVar(post.bodyFont),
    comments,
    owner,
  };
};
