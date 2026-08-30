import type { PageServerLoad } from './$types';
import { getPostByPreviewToken } from '$lib/blog';
import { renderArticle } from '$lib/blog/renderer';
import { bodyFontVar } from '$lib/blog/fonts';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const post = await getPostByPreviewToken(params.token);
  if (!post) throw error(404, 'Post not found');

  // Rendered through the SAME path as the published article — same sanitiser,
  // same anchors, same outline. The preview used to render with a different
  // container and without the `post-prose` class, so every rule keyed on that
  // class was invisible here: the author was reviewing a document that was not
  // the one that would ship. That is the whole point of a preview.
  const article = renderArticle(post.content, post.contentFormat);

  return {
    post,
    articleHtml: article.html,
    toc: article.toc,
    bodyFontVar: bodyFontVar(post.bodyFont),
  };
};
