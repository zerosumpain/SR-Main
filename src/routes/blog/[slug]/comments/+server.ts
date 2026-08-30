/**
 * Reader comments for one post.
 *
 * Lives under `/blog` rather than `/api` deliberately, and that placement is
 * the whole auth story: `/blog` is a PUBLIC_PATHS prefix (src/lib/auth.ts), so
 * everything beneath it is anonymous already and this route needs no new
 * allow-list entry. The alternative — `/api/blog/comments` — could not carry
 * the slug at all, because `isPublicApiPath` matches EXACTLY and a
 * parameterised path never equals its own literal. `/decks/[slug]/track` is
 * here for the same reason.
 *
 * Because the route is public, the hook's RATE_LIMITS table cannot see it:
 * that block sits inside `if (pathname.startsWith('/api/'))` and AFTER the
 * session check, so a public path returns long before it. Adding an entry
 * there would be dead code that reads like protection. This handler limits
 * itself — see `guardCommentPost`.
 *
 * Nothing posted here is ever visible until the owner admits it.
 */

import { json } from '@sveltejs/kit';
import { validateComment } from '$lib/blog/comments';
import {
  guardCommentPost,
  insertComment,
  publishedComments,
  publishedPostIdBySlug,
} from '$lib/blog/comments.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, setHeaders }) => {
  const postId = await publishedPostIdBySlug(params.slug);
  if (postId === null) return json({ comments: [] });

  // Same body for everyone — published comments only — so this is safely
  // cacheable. It is deliberately NOT varied on cookie: the owner's extra
  // moderation view is rendered by the page loader, never by this endpoint.
  setHeaders({ 'Cache-Control': 'public, max-age=30' });
  return json({ comments: await publishedComments(postId) });
};

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Could not read that.' }, { status: 400 });
  }

  const parsed = validateComment(raw);
  if (!parsed.ok) {
    // A tripped honeypot gets the success shape. Telling a bot which rule it
    // hit is how it learns to stop hitting it.
    if (parsed.error === 'honeypot') return json({ ok: true, held: true });
    return json({ error: parsed.error }, { status: 400 });
  }

  const postId = await publishedPostIdBySlug(params.slug);
  if (postId === null) {
    // An unknown slug and an unpublished one answer identically: a comment box
    // is not a probe for draft slugs.
    return json({ error: 'That post is not accepting comments.' }, { status: 404 });
  }

  const guard = await guardCommentPost(request, getClientAddress);
  if (!guard.allowed) {
    return json(
      { error: 'That is a lot of comments in a short time. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(guard.retryAfterSec) } },
    );
  }

  const parentRaw = (raw as { parentId?: unknown }).parentId;
  const parentId =
    typeof parentRaw === 'number' && Number.isInteger(parentRaw) && parentRaw > 0 ? parentRaw : null;

  await insertComment(postId, parsed.value, guard.authorHash, parentId);

  // `held: true` is the honest answer and the UI says so plainly. A comment
  // form that pretends to have published something, and then does not, is the
  // single most common way this feature annoys people.
  return json({ ok: true, held: true });
};
